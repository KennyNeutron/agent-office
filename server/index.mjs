import express from 'express'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverProviders, foldersOverlap, providerCommand, supportsKnowledgeMcp, supportsPermissionMode } from './providers.mjs'
import { DEFAULT_AGENTS, makeAgent, validStoredAgents, validateAgent } from './agents.mjs'
import { composeAgentPrompt } from './agent-prompt.mjs'
import { MAX_SCHEDULES, isDue, makeSchedule, migrateSchedules, recordRun, staleOnceSchedule, validStoredSchedules, validateSchedule } from './schedules.mjs'
import { jsonLines, parseMessage, shrink, taskFiles, taskReplies } from './task-output.mjs'
import { capNotes, extractKnowledgeNote, makeNote, relevantNotes, searchNotes, validateNoteInput, validStoredNotes } from './knowledge.mjs'
import { terminateProcess } from './processes.mjs'
import { MAX_CHAT_REPLY, appendChat, chatCommand, composeChatPrompt, validStoredChats, validateChatMessage } from './chat.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
// Installed CLI writes history to a user-writable directory. Source development
// keeps the existing .local/tasks.json location for backwards compatibility.
const STORE = join(process.env.AGENT_OFFICE_DATA_DIR || join(ROOT, '.local'), 'tasks.json')
const AGENT_STORE = join(dirname(STORE), 'agents.json')
const SCHEDULE_STORE = join(dirname(STORE), 'schedules.json')
const KNOWLEDGE_STORE = join(dirname(STORE), 'knowledge.json')
const KNOWLEDGE_MCP = join(HERE, 'knowledge-mcp.mjs')
const CHAT_STORE = join(dirname(STORE), 'chats.json')
const OFFICE_STORE = join(dirname(STORE), 'office.json')
// Interface preferences (theme, appearance, selected agent…) mirrored from the browser.
const SETTINGS_STORE = join(dirname(STORE), 'settings.json')
const SETTING_KEY = /^agent-office-[A-Za-z0-9._-]{1,80}$/
const MAX_SETTINGS_BYTES = 512 * 1024
const DESKTOP = process.env.AGENT_OFFICE_DESKTOP === '1'
const MAX_RECENT_PROJECTS = 8
// A chat reply that takes longer than this is stopped.
const CHAT_TIMEOUT_MS = Math.max(1000, Number(process.env.AGENT_OFFICE_CHAT_TIMEOUT_MS) || 10 * 60_000)
// How often due schedules are checked. Tests shorten it.
const SCHEDULER_MS = Math.max(200, Number(process.env.AGENT_OFFICE_SCHEDULER_MS) || 10_000)
const PORT = Number(process.env.PORT || 4300)
const MAX_TASKS = 150
const MAX_PROMPT = 10000
const INSTANCE_ID = process.env.AGENT_OFFICE_INSTANCE_ID || randomUUID()
let agents = DEFAULT_AGENTS.map(agent => makeAgent(agent, agent.id))
let agentsPersistChain = Promise.resolve()
let schedules = []
let schedulesPersistChain = Promise.resolve()
let schedulesReadable = true
let schedulerTimer
let schedulerRunning = false
let notes = []
let knowledgePersistChain = Promise.resolve()
let knowledgeReadable = true
// Bumped on every knowledge change so open browsers know to refetch.
let knowledgeVersion = 0
// The office-wide project folder used by tasks, schedules and chats unless one names another.
let office = { projectDirectory: null, recentProjects: [] }
let officePersistChain = Promise.resolve()
let officeReadable = true
let settings = {}
let settingsPersistChain = Promise.resolve()
let settingsReadable = true
const launchDirectory = () => process.env.AGENT_OFFICE_WORKSPACE || ROOT
const officeProject = () => office.projectDirectory || launchDirectory()
// Conversations by agent id, plus the reply currently being generated for each agent.
let chats = {}
let chatsPersistChain = Promise.resolve()
let chatsReadable = true
const chatRuns = new Map()
// Bumped whenever an agent's conversation changes so open chat windows refetch it.
const chatVersions = new Map()
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

// One office per data folder: two would each overwrite the other's stores. The
// desktop app and terminal runs share a folder, so the second one stops here.
const LOCK_FILE = join(dirname(STORE), 'office.lock')
function claimDataFolder() {
  mkdirSync(dirname(LOCK_FILE), { recursive: true })
  const mine = JSON.stringify({ pid: process.pid, port: PORT, desktop: DESKTOP })
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(LOCK_FILE, mine, { flag: 'wx', mode: 0o600 }); break }
    catch (error) {
      if (error.code !== 'EEXIST' || attempt) throw error
      let owner = null
      try { owner = JSON.parse(readFileSync(LOCK_FILE, 'utf8')) } catch { /* Unreadable: treat as stale. */ }
      let alive = false
      if (Number.isInteger(owner?.pid) && owner.pid !== process.pid) {
        try { process.kill(owner.pid, 0); alive = true } catch (probe) { alive = probe.code === 'EPERM' }
      }
      if (alive) {
        const where = owner.desktop ? 'the Agent Office desktop app' : `another Agent Office (http://127.0.0.1:${owner.port}/)`
        throw new Error(`${where} is already using ${dirname(LOCK_FILE)} (process ${owner.pid}). Close it first, or set AGENT_OFFICE_DATA_DIR to another folder.`)
      }
      try { unlinkSync(LOCK_FILE) } catch { /* Removed meanwhile. */ }
    }
  }
  process.on('exit', () => {
    try { if (JSON.parse(readFileSync(LOCK_FILE, 'utf8')).pid === process.pid) unlinkSync(LOCK_FILE) } catch { /* Already gone. */ }
  })
}
try { claimDataFolder() }
catch (error) { console.error('Could not start Agent Office:', error.message); process.exit(1) }

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
    defaultWorkspace: officeProject(),
    office: { projectDirectory: office.projectDirectory, recentProjects: office.recentProjects, launchDirectory: launchDirectory() },
    agents,
    tasks: tasks.map(visible),
    schedules,
    knowledgeVersion,
    chats: Object.fromEntries([...new Set([...Object.keys(chats), ...chatRuns.keys()])].map(id =>
      [id, { version: chatVersions.get(id) ?? 0, pending: chatRuns.has(id), count: chats[id]?.length ?? 0 }])),
    storage: { historyReadable, agentsReadable, schedulesReadable, knowledgeReadable, chatsReadable, officeReadable, historyWriteError },
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

// Same contract as the roster: serialized, atomic, acknowledged after the write.
function changeSchedules(edit) {
  const operation = schedulesPersistChain.then(async () => {
    if (!schedulesReadable) throw new Error('Existing schedules are unreadable; refusing to overwrite them.')
    const update = edit(schedules)
    if (update.error) return update
    await atomicWrite(SCHEDULE_STORE, JSON.stringify(update.next, null, 2))
    schedules = update.next
    notifyState()
    return update
  })
  schedulesPersistChain = operation.then(() => {}, error => console.error('Could not save schedules:', error.message))
  return operation
}

async function loadSchedules() {
  try {
    const stored = migrateSchedules(JSON.parse(await readFile(SCHEDULE_STORE, 'utf8')))
    if (validStoredSchedules(stored)) schedules = stored
    else throw new Error('Invalid schedules.json; the original file was preserved.')
  } catch (error) {
    if (error.code !== 'ENOENT') { schedulesReadable = false; console.error('Could not load schedules:', error.message) }
  }
}

// Same contract as schedules: serialized, atomic, acknowledged after the write.
function changeKnowledge(edit) {
  const operation = knowledgePersistChain.then(async () => {
    if (!knowledgeReadable) throw new Error('Existing knowledge is unreadable; refusing to overwrite it.')
    const update = edit(notes)
    if (update.error) return update
    const next = capNotes(update.next)
    await atomicWrite(KNOWLEDGE_STORE, JSON.stringify(next, null, 2))
    notes = next
    knowledgeVersion++
    notifyState()
    return update
  })
  knowledgePersistChain = operation.then(() => {}, error => console.error('Could not save knowledge:', error.message))
  return operation
}

async function loadKnowledge() {
  try {
    const stored = JSON.parse(await readFile(KNOWLEDGE_STORE, 'utf8'))
    if (validStoredNotes(stored)) notes = stored
    else throw new Error('Invalid knowledge.json; the original file was preserved.')
  } catch (error) {
    if (error.code !== 'ENOENT') { knowledgeReadable = false; console.error('Could not load knowledge:', error.message) }
  }
}

/** Knowledge is kept per project folder, keyed by its canonical path. */
function canonicalWorkspace(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || value.includes('\0') || !isAbsolute(value)) return null
  try { return statSync(value).isDirectory() ? realpathSync(value) : null } catch { return null }
}
const workspaceNotes = workspace => notes.filter(note => note.workspace === workspace)
/** Workspace-relative path for a file a run edited, or null when it lies outside the project. */
function projectPath(workspace, file) {
  const path = isAbsolute(file) ? relative(workspace, file) : file
  return !path || path.startsWith('..' + sep) || path === '..' || isAbsolute(path) ? null : path.split(sep).join('/')
}
const runningTask = id => typeof id === 'string' ? tasks.find(task => task.id === id && task.status === 'running') : undefined

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
      // 'gemini' is kept so tasks from the retired Gemini CLI integration stay readable.
      (task.provider == null || ['codex', 'claude', 'antigravity', 'gemini'].includes(task.provider)) &&
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
    if (chatsReadable && chats[req.params.id]) await changeChats(current => {
      const { [req.params.id]: _removed, ...rest } = current
      return { next: rest }
    }, req.params.id).catch(() => {})
    // Schedules cannot run without their agent; remove them with the profile.
    if (schedulesReadable && schedules.some(item => item.agentId === req.params.id)) {
      await changeSchedules(current => ({ next: current.filter(item => item.agentId !== req.params.id) })).catch(() => {})
    }
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Could not save agent profile.' }) }
})

// ---- Office project ---------------------------------------------------------
const validOffice = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
  (value.projectDirectory === null || (typeof value.projectDirectory === 'string' && isAbsolute(value.projectDirectory) && value.projectDirectory.length <= 1000)) &&
  Array.isArray(value.recentProjects) && value.recentProjects.length <= MAX_RECENT_PROJECTS &&
  value.recentProjects.every(item => typeof item === 'string' && isAbsolute(item) && item.length <= 1000)
async function loadOffice() {
  try {
    const stored = JSON.parse(await readFile(OFFICE_STORE, 'utf8'))
    if (validOffice(stored)) office = { projectDirectory: stored.projectDirectory, recentProjects: stored.recentProjects }
    else throw new Error('Invalid office.json; using the launch folder without overwriting the file.')
  } catch (error) {
    if (error.code !== 'ENOENT') { officeReadable = false; console.error('Could not load office settings:', error.message) }
  }
}
function changeOffice(edit) {
  const operation = officePersistChain.then(async () => {
    if (!officeReadable) throw new Error('Existing office settings are unreadable; refusing to overwrite them.')
    const next = edit(office)
    await atomicWrite(OFFICE_STORE, JSON.stringify(next, null, 2))
    office = next
    notifyState()
    return next
  })
  officePersistChain = operation.then(() => {}, error => console.error('Could not save office settings:', error.message))
  return operation
}
// Set the office project ({ path }), return to the launch folder ({ path: null }), or forget a recent one ({ forget }).
app.put('/api/office/project', async (req, res) => {
  const { path, forget } = req.body || {}
  if (!officeReadable) return res.status(503).json({ error: 'Office settings are unreadable. Preserve and repair office.json first.' })
  if (typeof forget === 'string') {
    try { await changeOffice(current => ({ ...current, recentProjects: current.recentProjects.filter(item => item !== forget) })); return res.json({ office }) }
    catch { return res.status(500).json({ error: 'Could not save office settings.' }) }
  }
  let canonical = null
  if (path !== null) {
    if (typeof path !== 'string' || !path.trim() || path.length > 1000 || path.includes('\0') || !isAbsolute(path.trim())) return res.status(400).json({ error: 'Enter an absolute project directory path.' })
    try {
      if (!statSync(path.trim()).isDirectory()) return res.status(400).json({ error: 'That path is not a folder.' })
      canonical = realpathSync(path.trim())
    } catch { return res.status(400).json({ error: 'Project directory was not found.' }) }
  }
  try {
    await changeOffice(current => ({ projectDirectory: canonical,
      recentProjects: canonical ? [canonical, ...current.recentProjects.filter(item => item !== canonical)].slice(0, MAX_RECENT_PROJECTS) : current.recentProjects }))
    res.json({ office, defaultWorkspace: officeProject() })
  } catch { res.status(500).json({ error: 'Could not save office settings.' }) }
})

// ---- Interface settings -------------------------------------------------------
// The browser keeps its preferences in localStorage, which a desktop webview ties to a
// random port. Mirroring them here keeps them in the data directory on this PC.
async function loadSettings() {
  try {
    const stored = JSON.parse(await readFile(SETTINGS_STORE, 'utf8'))
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) ||
      Object.entries(stored).some(([key, value]) => !SETTING_KEY.test(key) || typeof value !== 'string')) throw new Error('Invalid settings.json; the original file was preserved.')
    settings = stored
  } catch (error) {
    if (error.code !== 'ENOENT') { settingsReadable = false; console.error('Could not load settings:', error.message) }
  }
}
app.get('/api/settings', (_req, res) => res.json({ settings, desktop: DESKTOP }))
// Body: { values: { "agent-office-…": "text" | null } }. null removes a setting.
app.put('/api/settings', async (req, res) => {
  const values = req.body?.values
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
    Object.entries(values).some(([key, value]) => !SETTING_KEY.test(key) || (value !== null && typeof value !== 'string'))) return res.status(400).json({ error: 'Invalid settings.' })
  if (!settingsReadable) return res.status(503).json({ error: 'Settings are unreadable. Preserve and repair settings.json first.' })
  const operation = settingsPersistChain.then(async () => {
    const next = { ...settings }
    for (const [key, value] of Object.entries(values)) { if (value === null) delete next[key]; else next[key] = value }
    const contents = JSON.stringify(next, null, 2)
    if (Buffer.byteLength(contents) > MAX_SETTINGS_BYTES) return false
    await atomicWrite(SETTINGS_STORE, contents)
    settings = next
    return true
  })
  settingsPersistChain = operation.then(() => {}, error => console.error('Could not save settings:', error.message))
  try {
    if (await operation) res.json({ ok: true })
    else res.status(413).json({ error: 'Settings are too large.' })
  }
  catch { res.status(500).json({ error: 'Could not save settings.' }) }
})

// ---- Agent chat -------------------------------------------------------------
// Same contract as the roster: serialized, atomic, acknowledged after the write.
function changeChats(edit, agentId) {
  const operation = chatsPersistChain.then(async () => {
    if (!chatsReadable) throw new Error('Existing conversations are unreadable; refusing to overwrite them.')
    const update = edit(chats)
    if (update.error) return update
    await atomicWrite(CHAT_STORE, JSON.stringify(update.next, null, 2))
    chats = update.next
    chatVersions.set(agentId, (chatVersions.get(agentId) ?? 0) + 1)
    notifyState()
    return update
  })
  chatsPersistChain = operation.then(() => {}, error => console.error('Could not save conversations:', error.message))
  return operation
}
async function loadChats() {
  try {
    const stored = JSON.parse(await readFile(CHAT_STORE, 'utf8'))
    if (validStoredChats(stored)) chats = stored
    else throw new Error('Invalid chats.json; conversations are unavailable until the file is repaired.')
  } catch (error) {
    if (error.code !== 'ENOENT') { chatsReadable = false; console.error('Could not load conversations:', error.message) }
  }
}
const chatMessage = (role, text, extra = {}) => ({ id: randomUUID(), role, text, at: stamp(), ...extra })

app.get('/api/agents/:id/chat', (req, res) => {
  if (!agents.some(agent => agent.id === req.params.id)) return res.status(404).json({ error: 'Agent not found.' })
  res.json({ messages: chats[req.params.id] ?? [], pending: chatRuns.has(req.params.id), readable: chatsReadable })
})

// Replies use the agent's default provider (else the office's choice) and always run read-only.
app.post('/api/agents/:id/chat', async (req, res) => {
  if (!chatsReadable) return res.status(503).json({ error: 'Conversations are unreadable. Preserve and repair chats.json before chatting.' })
  await agentsPersistChain
  const agent = agents.find(item => item.id === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found.' })
  const { message, workspace: requestedWorkspace, provider: fallbackProvider } = req.body || {}
  const invalid = validateChatMessage(message)
  if (invalid) return res.status(400).json({ error: invalid })
  if (chatRuns.has(agent.id)) return res.status(409).json({ error: `${agent.name} is still answering your last message.` })
  const provider = providers.find(item => item.id === (agent.provider || fallbackProvider || 'codex'))
  if (!provider) return res.status(400).json({ error: 'Unknown AI provider.' })
  if (!provider.available) return res.status(503).json({ error: `${provider.name} was not found. Install and authenticate the CLI, then restart Agent Office.` })
  const workspace = typeof requestedWorkspace === 'string' && requestedWorkspace ? requestedWorkspace : officeProject()
  if (workspace.length > 1000 || workspace.includes('\0') || !isAbsolute(workspace)) return res.status(400).json({ error: 'Enter an absolute project directory path.' })
  let canonical
  try {
    if (!statSync(workspace).isDirectory()) return res.status(400).json({ error: 'The project directory is invalid.' })
    canonical = realpathSync(workspace)
  } catch { return res.status(400).json({ error: 'Project directory was not found.' }) }

  // Reserve the agent's chat before awaiting storage so two messages cannot race.
  const run = { child: null, stopping: null, stopped: false }
  run.done = new Promise(resolve => { run.resolveDone = resolve })
  chatRuns.set(agent.id, run)
  const history = chats[agent.id] ?? []
  const userMessage = chatMessage('user', message.trim())
  try { await changeChats(current => ({ next: { ...current, [agent.id]: appendChat(current[agent.id], userMessage) } }), agent.id) }
  catch { chatRuns.delete(agent.id); run.resolveDone(); notifyState(); return res.status(500).json({ error: 'Could not save the conversation.' }) }

  const finish = async (text, error = false) => {
    if (run.finished) return
    run.finished = true
    clearTimeout(run.timer)
    const reply = chatMessage('agent', String(text).slice(0, MAX_CHAT_REPLY), { provider: provider.id, ...(error ? { error: true } : {}) })
    await changeChats(current => ({ next: { ...current, [agent.id]: appendChat(current[agent.id], reply) } }), agent.id).catch(() => {})
    chatRuns.delete(agent.id)
    notifyState()
    run.resolveDone()
  }
  const { command, args, input } = chatCommand(provider, canonical, composeChatPrompt(agent, history, userMessage.text))
  let child
  try { child = spawn(command, args, { cwd: canonical, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }) }
  catch (error) { await finish(`Could not start ${provider.name}: ${shrink(error.message, 300)}`, true); return res.status(201).json({ message: userMessage, provider: provider.id }) }
  run.child = child
  // The output parser is shared with tasks; a scratch record collects the reply and any failure.
  const scratch = { provider: provider.id, events: [], lastMessage: '', phase: 'thinking' }
  const errors = []
  const reader = jsonLines(data => parseMessage(scratch, data, (_task, text, kind) => { if (kind === 'error') errors.push(text) }), () => errors.push('Provider output exceeded the supported record size.'))
  let stderr = ''
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => reader.push(chunk))
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1200) })
  child.on('error', error => errors.push(shrink(error.message, 400)))
  child.on('close', code => {
    reader.end()
    const text = taskReplies.get(scratch)
    if (run.stopped) void finish(run.stopped === 'timeout' ? `No reply within ${Math.round(CHAT_TIMEOUT_MS / 60_000) || 1} minutes, so the request was stopped.` : 'Reply stopped.', true)
    else if (code === 0 && !scratch.failure && text?.trim()) void finish(text.trim())
    else void finish(scratch.failure || errors.at(-1) || shrink(stderr, 500) || `${provider.name} exited with code ${code} without replying.`, true)
  })
  child.stdin.on('error', () => {})
  child.stdin.end(input)
  run.timer = setTimeout(() => { run.stopped = 'timeout'; run.stopping ||= terminateProcess(child).catch(() => {}) }, CHAT_TIMEOUT_MS)
  res.status(201).json({ message: userMessage, provider: provider.id })
})

app.post('/api/agents/:id/chat/stop', async (req, res) => {
  const run = chatRuns.get(req.params.id)
  if (!run?.child) return res.status(404).json({ error: 'No reply is in progress.' })
  run.stopped ||= 'user'
  try { run.stopping ||= terminateProcess(run.child); await run.stopping; res.json({ ok: true }) }
  catch { run.stopping = null; res.status(500).json({ error: 'Could not stop the reply.' }) }
})

app.delete('/api/agents/:id/chat', async (req, res) => {
  if (chatRuns.has(req.params.id)) return res.status(409).json({ error: 'Wait for the reply to finish, or stop it, before clearing the conversation.' })
  try {
    await changeChats(current => {
      const { [req.params.id]: _removed, ...rest } = current
      return { next: rest }
    }, req.params.id)
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Could not clear the conversation.' }) }
})

// ---- Team knowledge -------------------------------------------------------
function knowledgeRoute(handler) {
  return async (req, res) => {
    try {
      if (!knowledgeReadable && req.method !== 'GET') return res.status(503).json({ error: 'The knowledge file is unreadable. Preserve and repair it before editing notes.' })
      const result = await handler(req)
      if (result.error) return res.status(result.status || 400).json({ error: result.error })
      res.status(result.status || 200).json(result.body)
    } catch { res.status(500).json({ error: 'Could not save the note.' }) }
  }
}
const noteFields = body => ({ title: body?.title, body: body?.body, tags: body?.tags, files: body?.files })
app.get('/api/knowledge', knowledgeRoute(async req => {
  const workspace = canonicalWorkspace(req.query.workspace)
  if (!workspace) return { error: 'Project directory was not found.' }
  await knowledgePersistChain
  return { body: { workspace, notes: workspaceNotes(workspace).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) } }
}))
// Used by the agents' MCP bridge; reads are logged on the task that made them.
app.get('/api/knowledge/search', knowledgeRoute(async req => {
  const workspace = canonicalWorkspace(req.query.workspace)
  if (!workspace) return { error: 'Project directory was not found.' }
  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 500) : ''
  const results = searchNotes(workspaceNotes(workspace), query, { limit: Math.min(10, Math.max(1, Number(req.query.limit) || 5)) })
  const task = runningTask(req.query.task)
  if (task) addEvent(task, `Searched team knowledge for "${shrink(query, 60)}" (${results.length} note${results.length === 1 ? '' : 's'}).`)
  return { body: { results } }
}))
app.post('/api/knowledge/drafts', knowledgeRoute(async req => {
  const workspace = canonicalWorkspace(req.body?.workspace)
  if (!workspace) return { error: 'Project directory was not found.' }
  const error = validateNoteInput(noteFields(req.body))
  if (error) return { error }
  const task = runningTask(req.body.taskId)
  const result = await changeKnowledge(current => {
    const note = makeNote(noteFields(req.body), { id: randomUUID(), workspace, status: 'draft', source: 'agent', agentId: task?.agentId ?? null, taskId: task?.id ?? null })
    return { next: [...current, note], note }
  })
  if (task) addEvent(task, `Proposed knowledge note "${shrink(result.note.title, 60)}" for review.`)
  return { status: 201, body: { note: result.note } }
}))
app.get('/api/knowledge/:id', knowledgeRoute(async req => {
  const workspace = canonicalWorkspace(req.query.workspace)
  const note = notes.find(item => item.id === req.params.id && item.workspace === workspace)
  if (!note) return { status: 404, error: 'Note not found.' }
  const task = runningTask(req.query.task)
  if (task) addEvent(task, `Read team note "${shrink(note.title, 60)}".`)
  return { body: { note } }
}))
app.post('/api/knowledge', knowledgeRoute(async req => {
  const workspace = canonicalWorkspace(req.body?.workspace)
  if (!workspace) return { error: 'Project directory was not found.' }
  const error = validateNoteInput(noteFields(req.body))
  if (error) return { error }
  const result = await changeKnowledge(current => {
    const note = makeNote(noteFields(req.body), { id: randomUUID(), workspace })
    return { next: [...current, note], note }
  })
  return { status: 201, body: { note: result.note } }
}))
app.put('/api/knowledge/:id', knowledgeRoute(async req => {
  const error = validateNoteInput(noteFields(req.body))
  if (error) return { error }
  if (req.body.status != null && !['draft', 'active'].includes(req.body.status)) return { error: 'Invalid note status.' }
  const result = await changeKnowledge(current => {
    const previous = current.find(item => item.id === req.params.id)
    if (!previous) return { status: 404, error: 'Note not found.' }
    const note = makeNote({ ...noteFields(req.body), status: req.body.status }, {}, previous)
    return { next: current.map(item => item.id === note.id ? note : item), note }
  })
  return result.error ? result : { body: { note: result.note } }
}))
app.delete('/api/knowledge/:id', knowledgeRoute(async req => {
  const result = await changeKnowledge(current => current.some(item => item.id === req.params.id)
    ? { next: current.filter(item => item.id !== req.params.id) } : { status: 404, error: 'Note not found.' })
  return result.error ? result : { body: { ok: true } }
}))

// Live schedules must name an existing agent and an absolute project folder.
// Provider availability is checked when the schedule runs.
function scheduleError(input) {
  const error = validateSchedule(input)
  if (error) return error
  if (!agents.some(agent => agent.id === input.agentId)) return 'Unknown agent.'
  if (!isAbsolute(input.workspace)) return 'Enter an absolute project directory path.'
  if (staleOnceSchedule(input)) return 'Choose a time in the future.'
  return null
}
function scheduleRoute(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req)
      if (result.error) return res.status(result.status || 400).json({ error: result.error })
      res.status(result.status || 200).json(result.body)
    } catch { res.status(500).json({ error: 'Could not save schedule.' }) }
  }
}
app.post('/api/schedules', scheduleRoute(async req => {
  await agentsPersistChain
  const error = scheduleError(req.body)
  if (error) return { error }
  const result = await changeSchedules(current => current.length >= MAX_SCHEDULES
    ? { status: 409, error: `At most ${MAX_SCHEDULES} schedules are supported.` }
    : (schedule => ({ next: [...current, schedule], schedule }))(makeSchedule(req.body, randomUUID())))
  if (result.error) return result
  wakeScheduler()
  return { status: 201, body: { schedule: result.schedule } }
}))
app.put('/api/schedules/:id', scheduleRoute(async req => {
  await agentsPersistChain
  const error = scheduleError(req.body)
  if (error) return { error }
  const result = await changeSchedules(current => {
    const previous = current.find(item => item.id === req.params.id)
    if (!previous) return { status: 404, error: 'Schedule not found.' }
    const schedule = makeSchedule(req.body, previous.id, new Date(), previous)
    return { next: current.map(item => item.id === schedule.id ? schedule : item), schedule }
  })
  if (result.error) return result
  wakeScheduler()
  return { body: { schedule: result.schedule } }
}))
app.delete('/api/schedules/:id', scheduleRoute(async req => {
  const result = await changeSchedules(current => current.some(item => item.id === req.params.id)
    ? { next: current.filter(item => item.id !== req.params.id) } : { status: 404, error: 'Schedule not found.' })
  return result.error ? result : { body: { ok: true } }
}))
app.post('/api/schedules/:id/run', scheduleRoute(async req => {
  await schedulesPersistChain
  const schedule = schedules.find(item => item.id === req.params.id)
  if (!schedule) return { status: 404, error: 'Schedule not found.' }
  const result = await launchTask(schedule, schedule)
  if (result.status !== 201) return { status: result.status, error: result.body.error }
  // A manual run counts as the run for one-time schedules; recurring slots are unchanged.
  await changeSchedules(current => ({ next: current.map(item => item.id !== schedule.id ? item
    : item.repeat === 'once' ? recordRun(item, { status: 'launched', taskId: result.body.task.id })
    : { ...item, lastRunAt: stamp(), lastTaskId: result.body.task.id, lastStatus: 'launched', lastMessage: '' }) })).catch(() => {})
  return { status: 201, body: { task: result.body.task } }
}))

// Launch every due schedule once. A busy agent keeps the
// schedule waiting, so the run starts as soon as it is free; missed runs
// (for example while the office was closed) collapse into a single run.
async function runDueSchedules() {
  if (schedulerRunning || shuttingDown || !schedulesReadable) return
  schedulerRunning = true
  try {
    await schedulesPersistChain
    for (const due of schedules.filter(item => isDue(item))) {
      if (shuttingDown) break
      const result = await launchTask(due, due)
      const outcome = result.status === 201 ? { status: 'launched', taskId: result.body.task.id }
        : { status: result.status === 409 ? 'waiting' : 'failed', message: result.body.error }
      const current = schedules.find(item => item.id === due.id)
      // Skip rewriting an unchanged waiting state on every tick.
      if (!current || (outcome.status === 'waiting' && current.lastStatus === 'waiting' && current.lastMessage === outcome.message)) continue
      await changeSchedules(list => ({ next: list.map(item => item.id === due.id ? recordRun(item, outcome) : item) })).catch(() => {})
    }
  } finally { schedulerRunning = false }
}
function wakeScheduler() { setTimeout(() => { void runDueSchedules() }, 0) }

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

// Shared by the HTTP route and the scheduler so both apply identical checks.
const reply = (status, body) => ({ status, body })
async function launchTask(request, schedule = null) {
  if (!historyReadable) return reply(503, { error: 'Task history is unreadable. Preserve and repair the data file before launching tasks.' })
  if (!agentsReadable) return reply(503, { error: 'Agent profiles are unreadable. Preserve and repair the data file before launching tasks.' })
  const { prompt, agentId } = request
  // Requests that name no folder work in the office project.
  const workspace = request.workspace == null || request.workspace === '' ? officeProject() : request.workspace
  // An in-flight roster write must finish before resolving the selected agent.
  // Otherwise deletion could commit after this task reserves that same profile.
  await agentsPersistChain
  const agent = agents.find(item => item.id === agentId)
  if (!agent) return reply(400, { error: 'Unknown agent.' })
  // The agent's defaults apply when the request leaves a choice out, and always for
  // schedules that follow the agent, so profile edits reach their future runs.
  const followAgent = Boolean(schedule?.useAgentDefaults)
  const requestedProvider = (followAgent && agent.provider) || request.provider || agent.provider || 'codex'
  const permissionMode = (followAgent ? agent.permissionMode : request.permissionMode) || agent.permissionMode || 'restricted'
  const provider = providers.find(item => item.id === requestedProvider)
  if (!provider) return reply(400, { error: 'Unknown AI provider.' })
  if (!supportsPermissionMode(provider.id, permissionMode)) return reply(400, { error: 'This permission mode is unavailable for the selected provider.' })
  if (!provider.available) return reply(503, { error: `${provider.name} was not found. Install and authenticate the CLI, then restart Agent Office.` })
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) return reply(400, { error: 'Task is empty or too long.' })
  if (typeof workspace !== 'string' || workspace.length > 1000 || workspace.includes('\0') || !isAbsolute(workspace)) return reply(400, { error: 'Enter an absolute project directory path.' })
  try {
    if (!statSync(workspace).isDirectory()) return reply(400, { error: 'The project directory is invalid.' })
  } catch { return reply(400, { error: 'Project directory was not found.' }) }
  let canonical
  try { canonical = realpathSync(workspace) }
  catch { return reply(400, { error: 'Could not access the project directory.' }) }
  if ([...active.values()].some(a => a.task.agentId === agentId)) return reply(409, { error: 'Agent is already working.' })
  // Different agents may share a project folder; warn instead of blocking so they can work in parallel.
  const neighbours = [...new Set([...active.values()].filter(a => foldersOverlap(canonical, a.canonical)).map(a => a.task.agentName))]

  const task = {
    id: randomUUID(), agentId, agentName: agent.name, provider: provider.id, prompt, workspace, status: 'running', phase: 'thinking',
    createdAt: stamp(), updatedAt: stamp(), finishedAt: null, lastMessage: '', events: [], threadId: null, usage: null,
    ...(schedule ? { scheduleId: schedule.id } : {}),
  }
  tasks.unshift(task)
  // Never evict a running job when trimming history.
  const live = tasks.filter(item => item.status === 'running')
  tasks = [...live, ...tasks.filter(item => item.status !== 'running').slice(0, Math.max(0, MAX_TASKS - live.length))]
  if (schedule) addEvent(task, `Started by schedule "${shrink(schedule.title || schedule.prompt, 60)}".`)
  addEvent(task, permissionMode === 'restricted' ? `Task sent to ${provider.name}.`
    : `Task sent to ${provider.name} with ${permissionMode === 'full-access' ? 'Full Access' : 'Approve for me'}.`)
  if (neighbours.length) addEvent(task, `Sharing this project folder with ${shrink(neighbours.join(', '), 120)}, who ${neighbours.length > 1 ? 'are' : 'is'} also working. Edits to the same files may conflict.`)

  // Reserve the agent and canonical folder before awaiting durable storage.
  const running = { child: null, task, canonical, stopping: null }
  active.set(task.id, running)
  try { await persistHistory() }
  catch {
    active.delete(task.id)
    task.status = 'failed'; task.phase = 'idle'; task.finishedAt = stamp()
    task.failure = 'Could not save task history. No provider was launched.'
    addEvent(task, task.failure, 'error')
    return reply(500, { error: task.failure })
  }
  if (shuttingDown || task.cancelRequested) {
    active.delete(task.id)
    task.status = task.cancelRequested ? 'cancelled' : 'interrupted'
    task.phase = 'idle'; task.finishedAt = stamp()
    addEvent(task, 'Task stopped before launch.')
    await persistHistory().catch(() => {})
    return reply(409, { error: 'Task stopped before launch.' })
  }

  // Team knowledge: the most relevant approved notes go into the instructions, and
  // Claude Code / Codex also get the knowledge MCP tools for this run.
  const shared = knowledgeReadable ? relevantNotes(workspaceNotes(canonical), task.prompt) : []
  if (shared.length) addEvent(task, shrink(`Shared ${shared.length} team note${shared.length > 1 ? 's' : ''}: ${shared.map(note => `"${note.title}"`).join(', ')}.`, 300))
  const mcp = knowledgeReadable && supportsKnowledgeMcp(provider.id)
    ? { command: process.execPath, args: [KNOWLEDGE_MCP, '--url', `http://127.0.0.1:${PORT}`, '--workspace', canonical, '--task', task.id, '--agent', agentId] } : null
  const executionPrompt = composeAgentPrompt(agent, task.prompt, { notes: shared, mcp: Boolean(mcp) })
  const { command, args, input } = providerCommand(provider, canonical, executionPrompt, permissionMode, mcp)
  let child
  try { child = spawn(command, args, { cwd: canonical, shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }) }
  catch (error) {
    active.delete(task.id)
    task.status = 'failed'; task.phase = 'idle'; task.finishedAt = stamp()
    task.failure = shrink(error.message, 500); addEvent(task, task.failure, 'error')
    await persistHistory().catch(() => {})
    return reply(500, { error: task.failure })
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
    // A completed run that ended with a KNOWLEDGE NOTE section becomes a draft for review.
    const learned = task.status === 'completed' && knowledgeReadable ? extractKnowledgeNote(taskReplies.get(task)) : null
    if (learned) {
      const edited = [...(taskFiles.get(task) ?? [])].map(file => projectPath(canonical, file)).filter(Boolean)
      const draft = { ...learned, files: [...learned.files, ...edited] }
      if (!validateNoteInput(draft)) {
        await changeKnowledge(current => {
          const note = makeNote(draft, { id: randomUUID(), workspace: canonical, status: 'draft', source: 'task', agentId: task.agentId, taskId: task.id })
          return { next: [...current, note], note }
        }).then(({ note }) => addEvent(task, `Drafted knowledge note "${shrink(note.title, 60)}" for review.`)).catch(() => {})
      }
    }
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
  return reply(201, { task })
}

app.post('/api/tasks', async (req, res) => {
  const result = await launchTask(req.body || {})
  res.status(result.status).json(result.body)
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

await Promise.all([loadHistory(), loadAgents(), loadSchedules(), loadKnowledge(), loadChats(), loadOffice(), loadSettings()])
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
  schedulerTimer = setInterval(() => { void runDueSchedules() }, SCHEDULER_MS)
  wakeScheduler()
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
    clearInterval(schedulerTimer)
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
    await Promise.allSettled([...chatRuns.values()].map(async run => {
      run.stopped ||= 'user'
      if (run.child) await (run.stopping ||= terminateProcess(run.child))
      await run.done
    }))
    await agentsPersistChain
    await chatsPersistChain
    await officePersistChain
    await settingsPersistChain
    await schedulesPersistChain
    await knowledgePersistChain
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
// The desktop app holds the write end of stdin. When the app quits (or crashes), the
// pipe closes, so the office stops its agent processes and saves state on every OS.
if (DESKTOP) {
  process.stdin.on('error', () => {})
  process.stdin.on('end', () => {
    void shutdown().catch(error => { console.error('Office shutdown failed:', error.message); process.exitCode = 1 })
      .finally(() => process.exit())
  })
  process.stdin.resume()
}
