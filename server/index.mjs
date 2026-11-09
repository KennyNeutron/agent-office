import express from 'express'
import { spawn } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverProviders, foldersOverlap, providerCommand, supportsPermissionMode } from './providers.mjs'
import { DEFAULT_AGENTS, makeAgent, validStoredAgents, validateAgent } from './agents.mjs'
import { composeAgentPrompt } from './agent-prompt.mjs'
import { jsonLines, parseMessage, shrink } from './task-output.mjs'
import { terminateProcess } from './processes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
// Installed CLI writes history to a user-writable directory. Source development
// keeps the existing .local/tasks.json location for backwards compatibility.
const STORE = join(process.env.AGENT_OFFICE_DATA_DIR || join(ROOT, '.local'), 'tasks.json')
const AGENT_STORE = join(dirname(STORE), 'agents.json')
const PORT = Number(process.env.PORT || 4300)
const MAX_TASKS = 150
const MAX_PROMPT = 10000
const INSTANCE_ID = process.env.AGENT_OFFICE_INSTANCE_ID || randomUUID()
let agents = DEFAULT_AGENTS.map(agent => ({ ...agent }))
let agentsPersistChain = Promise.resolve()
const active = new Map()
const clients = new Set()
let tasks = []
let persistTimer
let persistChain = Promise.resolve()
let historyReadable = true
let agentsReadable = true
let historyWriteError = false
let shuttingDown = false
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Port must be between 1 and 65535.')

const providers = discoverProviders()
const app = express()
app.disable('x-powered-by')
app.use((req, res, next) => {
  // Protect static content too: an untrusted Host must not load a usable office.
  const host = req.headers.host
  if (typeof host !== 'string' || !/^(localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host)) {
    return res.status(403).json({ error: 'Host is not authorized.' })
  }
  const origin = req.headers.origin
  const allowed = origin && ['127.0.0.1', 'localhost'].some(host =>
    origin === `http://${host}:${PORT}` || origin === `http://${host}:5173`)
  if (origin && !allowed) return res.status(403).json({ error: 'Origin is not authorized.' })
  // Fetch metadata covers browsers which omit Origin; local CLI clients remain supported.
  if (req.path.startsWith('/api') && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Origin is not authorized.' })
  if (shuttingDown && req.path.startsWith('/api')) return res.status(503).json({ error: 'Office is shutting down.' })
  next()
})
app.use('/api', express.json({ limit: '64kb' }))
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  const emptyCancel = req.method === 'POST' && /^\/tasks\/[^/]+\/cancel$/.test(req.path) &&
    !req.headers['transfer-encoding'] && (!req.headers['content-length'] || req.headers['content-length'] === '0')
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !emptyCancel && !req.is('application/json')) {
    return res.status(415).json({ error: 'Use application/json.' })
  }
  next()
})

const stamp = () => new Date().toISOString()
const visible = task => ({ ...task })

function snapshot() {
  return {
    connected: true,
    instanceId: INSTANCE_ID,
    codexAvailable: providers.find(provider => provider.id === 'codex').available,
    providers: providers.map(({ id, name, available }) => ({ id, name, available })),
    defaultWorkspace: process.env.AGENT_OFFICE_WORKSPACE || ROOT,
    agents,
    tasks: tasks.map(visible),
    storage: { historyReadable, agentsReadable, historyWriteError },
  }
}

// Serialize edits and acknowledge them only after the new roster is safely on disk.
async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(contents); await file.sync() }
    finally { await file.close() }
    await rename(temporary, path)
  }
  finally { await rm(temporary, { force: true }).catch(() => {}) }
}

function changeAgents(edit) {
  const operation = agentsPersistChain.then(async () => {
    if (!agentsReadable) throw new Error('Existing profiles are unreadable; refusing to overwrite them.')
    const update = edit(agents)
    if (update.error) return update
    const contents = JSON.stringify(update.next, null, 2)
    await atomicWrite(AGENT_STORE, contents)
    agents = update.next
    notifyState()
    return update
  })
  agentsPersistChain = operation.then(() => {}, error => console.error('Could not save agents:', error.message))
  return operation
}

async function loadAgents() {
  try {
    const stored = JSON.parse(await readFile(AGENT_STORE, 'utf8'))
    if (validStoredAgents(stored)) agents = stored.map(agent => makeAgent(agent, agent.id))
    else throw new Error('Invalid agents.json; retained defaults without overwriting the file.')
  } catch (error) {
    if (error.code !== 'ENOENT') { agentsReadable = false; console.error('Could not load agents:', error.message) }
  }
}

function persistHistory() {
  if (!historyReadable) return Promise.reject(new Error('Existing history is unreadable; refusing to overwrite it.'))
  const contents = JSON.stringify(tasks, null, 2)
  const operation = persistChain.then(async () => { await atomicWrite(STORE, contents); historyWriteError = false })
  persistChain = operation.catch(error => {
    historyWriteError = true
    console.error('Could not save task history:', error.message)
    notifyState()
  })
  return operation
}

function notify() {
  notifyState()
  // Fixed deadline: continuous output cannot postpone saving indefinitely.
  if (!persistTimer && historyReadable && !shuttingDown) persistTimer = setTimeout(() => {
    persistTimer = undefined
    void persistHistory().catch(() => {})
  }, 300)
}

function addEvent(task, message, kind = 'info') {
  task.events = [...task.events, { id: randomUUID(), at: stamp(), kind, message: shrink(message, 350) }].slice(-35)
  task.updatedAt = stamp()
  notify()
}

async function loadHistory() {
  try {
    const value = JSON.parse(await readFile(STORE, 'utf8'))
    const object = item => item && typeof item === 'object' && !Array.isArray(item)
    const optionalText = item => item == null || typeof item === 'string'
    if (!Array.isArray(value) || !value.every(task => object(task) &&
      typeof task.id === 'string' && typeof task.agentId === 'string' && typeof task.prompt === 'string' &&
      typeof task.workspace === 'string' && ['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(task.status) &&
      ['thinking', 'coding', 'researching', 'finishing', 'idle'].includes(task.phase) &&
      typeof task.createdAt === 'string' && typeof task.updatedAt === 'string' && optionalText(task.finishedAt) &&
      optionalText(task.agentName) && optionalText(task.failure) &&
      (task.provider == null || ['codex', 'claude', 'gemini'].includes(task.provider)) &&
      (task.usage == null || (object(task.usage) && ['input_tokens', 'output_tokens'].every(key => task.usage[key] == null ||
        (typeof task.usage[key] === 'number' && Number.isFinite(task.usage[key]))))) &&
      (task.events === undefined || (Array.isArray(task.events) && task.events.every(event => object(event) &&
        ['id', 'at', 'kind', 'message'].every(key => typeof event[key] === 'string'))))) ||
      new Set(value.map(task => task.id)).size !== value.length) {
      throw new Error('Invalid task history; the original file was preserved.')
    }
    tasks = value.slice(0, MAX_TASKS).map(task => ({ ...task, provider: task.provider || 'codex', events: task.events || [], finishedAt: task.finishedAt || null,
      ...(task.status === 'running' ? { status: 'interrupted', phase: 'idle', finishedAt: stamp(), updatedAt: stamp() } : {}) }))
  } catch (error) {
    if (error.code !== 'ENOENT') { historyReadable = false; console.error('Could not load history:', error.message) }
  }
}

app.get('/api/state', (_req, res) => res.json(snapshot()))
app.post('/api/agents', async (req, res) => {
  const error = validateAgent(req.body)
  if (error) return res.status(400).json({ error })
  try {
    const { agent } = await changeAgents(current => {
      const agent = makeAgent(req.body)
      return { next: [...current, agent], agent }
    })
    res.status(201).json({ agent })
  } catch { res.status(500).json({ error: 'Could not save agent profile.' }) }
})
app.put('/api/agents/:id', async (req, res) => {
  const error = validateAgent(req.body)
  if (error) return res.status(400).json({ error })
  try {
    const result = await changeAgents(current => {
      if (!current.some(agent => agent.id === req.params.id)) return { status: 404, error: 'Agent not found.' }
      const agent = makeAgent(req.body, req.params.id)
      return { next: current.map(item => item.id === agent.id ? agent : item), agent }
    })
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ agent: result.agent })
  } catch { res.status(500).json({ error: 'Could not save agent profile.' }) }
})
app.delete('/api/agents/:id', async (req, res) => {
  try {
    const result = await changeAgents(current => {
      if (!current.some(agent => agent.id === req.params.id)) return { status: 404, error: 'Agent not found.' }
      if ([...active.values()].some(item => item.task.agentId === req.params.id)) return { status: 409, error: 'Agent is working. Stop or finish their task first.' }
      return { next: current.filter(agent => agent.id !== req.params.id) }
    })
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Could not save agent profile.' }) }
})

// Roster changes only notify browsers. Task history is written separately.
function notifyState() {
  const data = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`
  for (const client of clients) {
    if (client.destroyed || client.writableEnded) { clients.delete(client); continue }
    if (client.writableLength > 1024 * 1024) { client.destroy(); clients.delete(client); continue }
    try { client.write(data) } catch { client.destroy(); clients.delete(client) }
  }
}
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`)
  clients.add(res)
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n')
  }, 20000)
  const cleanup = () => { clearInterval(heartbeat); clients.delete(res) }
  res.on('close', cleanup)
  res.on('error', cleanup)
})

app.post('/api/tasks', async (req, res) => {
  if (!historyReadable) return res.status(503).json({ error: 'Task history is unreadable. Preserve and repair the data file before launching tasks.' })
  if (!agentsReadable) return res.status(503).json({ error: 'Agent profiles are unreadable. Preserve and repair the data file before launching tasks.' })
  const { prompt, agentId, workspace, provider: requestedProvider = 'codex', permissionMode = 'restricted' } = req.body || {}
  const provider = providers.find(item => item.id === requestedProvider)
  if (!provider) return res.status(400).json({ error: 'Motor de IA desconhecido.' })
  if (!supportsPermissionMode(provider.id, permissionMode)) return res.status(400).json({ error: 'This permission mode is unavailable for the selected provider.' })
  if (!provider.available) return res.status(503).json({ error: `${provider.name} was not found. Install and authenticate the CLI, then restart Agent Office.` })
  // An in-flight roster write must finish before resolving the selected agent.
  // Otherwise deletion could commit after this task reserves that same profile.
  await agentsPersistChain
  const agent = agents.find(item => item.id === agentId)
  if (!agent) return res.status(400).json({ error: 'Agente desconhecido.' })
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) return res.status(400).json({ error: 'Tarefa vazia ou extensa demais.' })
  if (typeof workspace !== 'string' || workspace.length > 1000 || workspace.includes('\0') || !isAbsolute(workspace)) return res.status(400).json({ error: 'Informe uma pasta de projeto com caminho absoluto.' })
  try {
    if (!statSync(workspace).isDirectory()) return res.status(400).json({ error: 'The project directory is invalid.' })
  } catch { return res.status(400).json({ error: 'Project directory was not found.' }) }
  let canonical
  try { canonical = realpathSync(workspace) }
  catch { return res.status(400).json({ error: 'Could not access the project directory.' }) }
  if ([...active.values()].some(a => a.task.agentId === agentId)) return res.status(409).json({ error: 'Agent is already working.' })
  if ([...active.values()].some(a => foldersOverlap(canonical, a.canonical))) return res.status(409).json({ error: 'A task is already running in an overlapping directory. Wait for it to finish or choose another project.' })

  const task = {
    id: randomUUID(), agentId, agentName: agent.name, provider: provider.id, prompt, workspace, status: 'running', phase: 'thinking',
    createdAt: stamp(), updatedAt: stamp(), finishedAt: null, lastMessage: '', events: [], threadId: null, usage: null,
  }
  tasks.unshift(task)
  // Never evict a running job when trimming history.
  const live = tasks.filter(item => item.status === 'running')
  tasks = [...live, ...tasks.filter(item => item.status !== 'running').slice(0, Math.max(0, MAX_TASKS - live.length))]
  addEvent(task, permissionMode === 'restricted' ? `Task sent to ${provider.name}.`
    : `Task sent to ${provider.name} with ${permissionMode === 'full-access' ? 'Full Access' : 'Approve for me'}.`)

  // Reserve the agent and canonical folder before awaiting durable storage.
  const running = { child: null, task, canonical, stopping: null }
  active.set(task.id, running)
  try { await persistHistory() }
  catch {
    active.delete(task.id)
    task.status = 'failed'; task.phase = 'idle'; task.finishedAt = stamp()
    task.failure = 'Could not save task history. No provider was launched.'
    addEvent(task, task.failure, 'error')
    return res.status(500).json({ error: task.failure })
  }
  if (shuttingDown || task.cancelRequested) {
    active.delete(task.id)
    task.status = task.cancelRequested ? 'cancelled' : 'interrupted'
    task.phase = 'idle'; task.finishedAt = stamp()
    addEvent(task, 'Task stopped before launch.')
    await persistHistory().catch(() => {})
    return res.status(409).json({ error: 'Task stopped before launch.' })
  }

  const executionPrompt = composeAgentPrompt(agent, task.prompt)
  const { command, args, input } = providerCommand(provider, canonical, executionPrompt, permissionMode)
  let child
  try { child = spawn(command, args, { cwd: canonical, shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }) }
  catch (error) {
    active.delete(task.id)
    task.status = 'failed'; task.phase = 'idle'; task.finishedAt = stamp()
    task.failure = shrink(error.message, 500); addEvent(task, task.failure, 'error')
    await persistHistory().catch(() => {})
    return res.status(500).json({ error: task.failure })
  }
  running.child = child
  running.done = new Promise(resolve => { running.resolveDone = resolve })
  let stderr = ''
  const reader = jsonLines(data => { parseMessage(task, data, addEvent); notify() }, () => {
    task.failure = 'Provider output exceeded the supported record size.'
    addEvent(task, task.failure, 'error')
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => reader.push(chunk))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1200) })
  child.on('error', error => { task.failure = shrink(error.message, 400); addEvent(task, task.failure, 'error') })
  running.finish = async (code, signal) => {
    if (running.finalized) return
    reader.end()
    // Keep the workspace reserved until descendant termination finishes.
    if (running.stopping) {
      try { await running.stopping }
      catch (error) { task.failure = shrink(error.message, 500); return }
    }
    if (running.finalized) return
    active.delete(task.id)
    running.finalized = true
    task.exitCode = code; task.signal = signal || null
    task.status = task.cancelRequested ? 'cancelled' : shuttingDown ? 'interrupted'
      : code === 0 && !task.failure && task.outputComplete ? 'completed' : 'failed'
    task.phase = 'idle'; task.finishedAt = stamp()
    if (task.status === 'failed') task.failure ||= shrink(task.events.filter(e => e.kind === 'error').at(-1)?.message || stderr ||
      (code === 0 ? 'Provider exited without a completion event.' : `${provider.name} exited with code ${code}.`), 500)
    addEvent(task, task.status === 'completed' ? 'Provider run finished. See the agent reply for changes and verification.' : task.status === 'cancelled' ? 'Task cancelled.'
      : task.status === 'interrupted' ? 'Task interrupted by office shutdown.' : `Failed: ${task.failure}`, task.status === 'completed' ? 'success' : 'error')
    await persistHistory().catch(() => {})
    running.resolveDone()
  }
  child.on('close', (code, signal) => {
    running.closed = { code, signal }
    void running.finish(code, signal)
  })
  child.stdin.on('error', error => {
    if (error.code !== 'EPIPE') { task.failure = shrink(error.message, 400); addEvent(task, task.failure, 'error') }
  })
  child.stdin.end(input)
  res.status(201).json({ task })
})

app.post('/api/tasks/:id/cancel', async (req, res) => {
  const running = active.get(req.params.id)
  if (!running) return res.status(404).json({ error: 'Running task was not found.' })
  if (!running.task.cancelRequested) { running.task.cancelRequested = true; addEvent(running.task, 'Cancellation requested.') }
  try {
    running.stopping ||= terminateProcess(running.child)
    await running.stopping
    if (running.closed) await running.finish(running.closed.code, running.closed.signal)
    res.json({ ok: true })
  } catch (error) {
    running.stopping = null
    addEvent(running.task, shrink(error.message, 400), 'error')
    res.status(500).json({ error: 'Could not stop the provider. The workspace remains reserved.' })
  }
})

await Promise.all([loadHistory(), loadAgents()])
if (existsSync(join(ROOT, 'dist', 'index.html'))) {
  app.use(express.static(join(ROOT, 'dist')))
  app.get('/', (_req, res) => res.sendFile(join(ROOT, 'dist', 'index.html')))
}
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }))
app.use((error, _req, res, _next) => {
  if (res.headersSent) { res.destroy(); return }
  const status = error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500
  res.status(status).json({ error: status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid JSON body.' : 'Internal server error.' })
})
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent Office API: http://127.0.0.1:${PORT}`)
  for (const provider of providers) console.log(`${provider.name}: ${provider.available ? 'detected' : 'not found'}`)
})

server.on('error', error => { console.error('Could not start Agent Office:', error.message); process.exitCode = 1 })
export const ready = new Promise(resolve => {
  server.once('listening', () => resolve(true))
  server.once('error', () => resolve(false))
})
let shutdownPromise
export function shutdown() {
  return shutdownPromise ||= (async () => {
    shuttingDown = true
    clearTimeout(persistTimer); persistTimer = undefined
    const closed = new Promise(resolve => server.close(resolve))
    const forceClose = setTimeout(() => server.closeAllConnections(), 3000)
    forceClose.unref()
    for (const client of clients) client.end()
    clients.clear()
    const results = await Promise.allSettled([...active.values()].map(async running => {
      if (!running.child) return
      running.stopping ||= terminateProcess(running.child)
      await running.stopping
      if (running.closed) await running.finish(running.closed.code, running.closed.signal)
      await running.done
    }))
    for (const result of results) if (result.status === 'rejected') { console.error(result.reason.message); process.exitCode = 1 }
    await agentsPersistChain
    if (historyReadable) await persistHistory().catch(() => { process.exitCode = 1 })
    await closed
    clearTimeout(forceClose)
  })()
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => {
  void shutdown().catch(error => { console.error('Office shutdown failed:', error.message); process.exitCode = 1 })
})
// The IDE owns a private IPC channel. Let it stop the office gracefully on
// Windows too, before using forced process-tree termination as a fallback.
if (process.channel) {
  process.on('message', message => {
    if (message?.type === 'agent-office:shutdown' && message.instanceId === INSTANCE_ID) {
      void shutdown().then(() => { if (process.connected) process.disconnect() }).catch(error => console.error(error.message))
    }
  })
  process.on('disconnect', () => { void shutdown().catch(error => console.error(error.message)) })
}
