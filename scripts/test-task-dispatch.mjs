import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'

const sleep = ms => new Promise(done => setTimeout(done, ms))

test('task dispatch passes the agent profile and preserves the human request for every CLI', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-office-dispatch-'))
  const workspace = join(root, 'project')
  const data = join(root, 'data')
  const captures = join(root, 'captures')
  const fakeCli = join(root, 'fake-provider.js')
  await Promise.all([mkdir(workspace), mkdir(captures)])
  await writeFile(fakeCli, [
    "const { writeFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    'const args = process.argv.slice(2)',
    "const provider = args.includes('exec') ? 'codex' : args.some(arg => arg.startsWith('--print=')) ? 'antigravity' : 'claude'",
    "let incoming = ''",
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data', part => incoming += part)",
    "process.stdin.on('end', () => {",
    "  const prompt = provider === 'antigravity' ? args.find(arg => arg.startsWith('--print=')).slice(8) : incoming",
    "  writeFileSync(join(process.env.AGENT_OFFICE_FAKE_CAPTURE, provider + '.json'), JSON.stringify({ args, prompt }))",
    "  process.stdout.write(JSON.stringify(provider === 'codex' ? { type: 'turn.completed' } : provider === 'claude' ? { type: 'result' } : { event: 'result', result: { status: 'SUCCESS' } }) + '\\n')",
    '})',
  ].join('\n'))

  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise(done => listener.close(done))
  const base = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, [resolve('server/index.mjs')], {
    cwd: resolve('.'), windowsHide: true, stdio: 'ignore',
    env: {
      ...process.env, PORT: String(port), AGENT_OFFICE_DATA_DIR: data,
      CODEX_BIN: fakeCli, CLAUDE_BIN: fakeCli, AGY_BIN: fakeCli,
      AGENT_OFFICE_FAKE_CAPTURE: captures,
    },
  })
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, {
      method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result)}`)
    return result
  }
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error('Isolated API exited')
      try { ready = (await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(500) })).ok } catch { /* start-up */ }
      if (ready) break
      await sleep(70)
    }
    assert.ok(ready, 'Isolated API did not start')
    const state = await request('/api/state')
    assert.ok(state.providers.every(provider => provider.available), 'Mock CLIs must be available')
    const existing = state.agents[0]
    const profile = { ...existing, name: 'Review Specialist', role: 'Visual QA', specialty: 'Animation posture', department: 'quality' }
    await request(`/api/agents/${existing.id}`, 'PUT', profile)
    const humanPrompt = '  Review the seating transition.\nQuotes " & ; $(literal). Do not alter the live project.  '
    for (const provider of ['codex', 'claude', 'antigravity']) {
      const { task } = await request('/api/tasks', 'POST', { agentId: existing.id, provider, workspace, prompt: humanPrompt })
      assert.equal(task.prompt, humanPrompt, 'History must retain the original task')
      let completed = false
      for (let i = 0; i < 100; i++) {
        const latest = (await request('/api/state')).tasks.find(item => item.id === task.id)
        if (latest.status !== 'running') {
          assert.equal(latest.status, 'completed', `${provider} mock must complete successfully`)
          completed = true
          break
        }
        await sleep(40)
      }
      assert.ok(completed, `${provider} job did not finish`)
      const capture = JSON.parse(await readFile(join(captures, provider + '.json'), 'utf8'))
      const expected = provider === 'codex'
        ? ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', workspace, '-']
        : provider === 'claude'
          ? ['--print', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none']
          : [`--print=${capture.prompt}`, '--output-format', 'stream-json', '--disable-slash-commands', '--mode', 'accept-edits']
      // Claude Code and Codex also receive the team knowledge MCP server for this run.
      const mcpFlags = new Set(['--mcp-config', '--allowedTools', '-c'])
      const mcp = [], argv = []
      for (let i = 0; i < capture.args.length; i++) {
        if (mcpFlags.has(capture.args[i]) && (capture.args[i] !== '-c' || capture.args[i + 1]?.startsWith('mcp_servers.agent_office.'))) { mcp.push(capture.args[i], capture.args[++i]); continue }
        argv.push(capture.args[i])
      }
      assert.deepEqual(argv, expected, `${provider} must receive the exact argv, without shell interpretation`)
      if (provider === 'antigravity') assert.deepEqual(mcp, [], 'Antigravity CLI has no per-run MCP configuration')
      else assert.ok(mcp.join(' ').includes('knowledge-mcp.mjs') && mcp.join(' ').includes(task.id), `${provider} must receive the knowledge MCP server for this task`)
      for (const field of ['Review Specialist', 'Visual QA', 'Animation posture', 'quality', humanPrompt]) {
        assert.ok(capture.prompt.includes(field), `${provider} did not receive ${field}`)
      }
    }
  } finally {
    if (server.exitCode === null) {
      const done = once(server, 'exit')
      server.kill()
      await Promise.race([done, sleep(5000).then(() => { throw new Error('Isolated API could not stop') })])
    }
    await rm(root, { force: true, recursive: true })
  }
})

async function until(check, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await sleep(30) }
  throw new Error('Timed out waiting for isolated fixture')
}

// Every subprocess in this harness is either the local API or disposable Node
// code. Explicit overrides prevent any installed AI CLI from being launched.
async function fixture(t, mode = 'success', files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'agent-office-audit-'))
  const data = join(root, 'data'), workspace = join(root, 'project & spaces')
  await mkdir(data); await mkdir(workspace)
  for (const [name, contents] of Object.entries(files)) await writeFile(join(data, name), contents)
  const fake = join(root, 'fake.cjs'), capture = join(root, 'capture.json'), tick = join(root, 'tick.txt')
  await writeFile(fake, `
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const args = process.argv.slice(2)
const provider = args.includes('exec') ? 'codex' : args.some(arg => arg.startsWith('--print=')) ? 'antigravity' : 'claude'
const mode = process.env.AO_FIXTURE_MODE
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n')
let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', value => prompt += value)
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.AO_CAPTURE, JSON.stringify({ args, prompt, cwd: process.cwd(), pid: process.pid }))
  if (mode === 'hold') {
    const grandchild = spawn(process.execPath, ['-e', "const fs=require('node:fs'); let count=0; process.on('SIGTERM',()=>{}); setInterval(()=>fs.writeFileSync(process.env.AO_TICK,String(++count)),40)"], { stdio:'ignore', windowsHide:true })
    fs.writeFileSync(process.env.AO_CAPTURE, JSON.stringify({ args, prompt, cwd: process.cwd(), pid:process.pid, descendant:grandchild.pid }))
    process.on('SIGTERM', () => {})
    let count = 0
    setInterval(() => emit({type:'item.completed',item:{type:'agent_message',text:'progress ' + ++count}}), 40)
    return
  }
  if (mode === 'empty') return
  if (mode === 'failure') {
    process.stdout.write(JSON.stringify(provider === 'codex' ? {type:'turn.failed',error:{message:'fixture failed'}} : provider === 'claude' ? {type:'result',subtype:'error_max_turns',errors:['fixture failed']} : {event:'result',result:{status:'ERROR',error:{message:'fixture failed'}}}))
    return
  }
  if (mode === 'stderr') { process.stderr.write('fixture stderr failure'); process.exitCode = 9; return }
  emit({type:'error',message:'recoverable warning'})
  const result = provider === 'codex' ? {type:'turn.completed',usage:{input_tokens:2}} : provider === 'claude' ? {type:'result',subtype:'success'} : {event:'result',result:{status:'SUCCESS',response:'done'}}
  process.stdout.write(JSON.stringify(result)) // Intentionally no final newline.
})
`)
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
  const port = listener.address().port; await new Promise(done => listener.close(done))
  const wrapper = join(root, 'server-wrapper.mjs')
  await writeFile(wrapper, `import { ready } from ${JSON.stringify(pathToFileURL(resolve('server/index.mjs')).href)}; await ready;`)
  let server
  const base = `http://127.0.0.1:${port}`
  const start = async () => {
    server = spawn(process.execPath, [wrapper], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: {
      ...process.env, PORT: String(port), AGENT_OFFICE_DATA_DIR: data, AGENT_OFFICE_WORKSPACE: workspace,
      AGENT_OFFICE_INSTANCE_ID: `fixture-${port}`,
      CODEX_BIN: fake, CLAUDE_BIN: fake, AGY_BIN: fake, AO_CAPTURE: capture, AO_TICK: tick, AO_FIXTURE_MODE: mode,
    } })
    let errors = ''
    server.stderr.on('data', chunk => errors += chunk)
    await until(async () => {
      if (server.exitCode !== null) throw new Error('Fixture API exited: ' + errors)
      try { return (await fetch(base + '/api/state', { signal: AbortSignal.timeout(200) })).ok } catch { return false }
    })
  }
  const stop = async () => {
    if (!server || server.exitCode !== null) return
    const exited = once(server, 'exit')
    server.send({ type:'agent-office:shutdown', instanceId:`fixture-${port}` })
    await Promise.race([exited, sleep(5000).then(() => { throw new Error('Fixture shutdown timed out') })])
  }
  t.after(async () => {
    await stop()
    assert.ok(root.startsWith(join(tmpdir(), 'agent-office-audit-')))
    await rm(root, { recursive: true, force: true })
  })
  await start()
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(4000) })
    return { status: response.status, body: await response.json() }
  }
  const launch = async (provider = 'codex', changes = {}) => request('/api/tasks', 'POST', { provider, agentId: 'atlas', workspace, prompt: 'Safe fixture task', ...changes })
  const task = async id => (await request('/api/state')).body.tasks.find(item => item.id === id)
  return { root, data, workspace, fake, capture, tick, base, request, launch, task, start, stop }
}

test('all providers recognize terminal records without newline and persist acknowledged tasks across restart', async t => {
  const f = await fixture(t)
  for (const provider of ['codex', 'claude', 'antigravity']) {
    const result = await f.launch(provider)
    assert.equal(result.status, 201)
    const id = result.body.task.id
    const finished = await until(async () => { const task = await f.task(id); return task.status !== 'running' && task })
    assert.equal(finished.status, 'completed')
    assert.equal(finished.failure, undefined)
    await until(async () => JSON.parse(await readFile(join(f.data, 'tasks.json'), 'utf8')).some(item => item.id === id && item.status === 'completed'))
  }
  await f.stop(); await f.start()
  assert.equal((await f.request('/api/state')).body.tasks.filter(task => task.status === 'completed').length, 3)
})

test('agent default provider and permissions apply to tasks and to schedules that follow the agent', async t => {
  const f = await fixture(t)
  const atlas = { name: 'Atlas', role: 'Tech Lead', specialty: 'Architecture & planning', color: '#8b82ff', department: 'architecture' }
  assert.equal((await f.request('/api/agents/atlas', 'PUT', { ...atlas, provider: 'antigravity', permissionMode: 'approve-for-me' })).status, 400)
  assert.equal((await f.request('/api/agents/atlas', 'PUT', { ...atlas, provider: 'warp' })).status, 400)
  const saved = await f.request('/api/agents/atlas', 'PUT', { ...atlas, provider: 'claude', permissionMode: 'full-access' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.agent.provider, 'claude'); assert.equal(saved.body.agent.permissionMode, 'full-access')
  const finish = async id => until(async () => { const task = await f.task(id); return task.status !== 'running' && task })

  // A task request that leaves the choices out uses the agent's defaults.
  const implicit = await f.request('/api/tasks', 'POST', { agentId: 'atlas', workspace: f.workspace, prompt: 'Safe fixture task' })
  assert.equal(implicit.status, 201)
  assert.equal(implicit.body.task.provider, 'claude')
  assert.ok(implicit.body.task.events.some(event => /Full Access/.test(event.message)))
  await finish(implicit.body.task.id)
  // An explicit choice still wins.
  const explicit = await f.launch('codex', { permissionMode: 'restricted' })
  assert.equal(explicit.body.task.provider, 'codex')
  assert.ok(!explicit.body.task.events.some(event => /Full Access/.test(event.message)))
  await finish(explicit.body.task.id)

  const base = { agentId: 'atlas', prompt: 'Check', workspace: f.workspace, provider: 'codex', permissionMode: 'restricted',
    repeat: 'daily', time: '09:00', runAt: null, intervalMinutes: null, days: null, enabled: false }
  const follows = await f.request('/api/schedules', 'POST', { ...base, useAgentDefaults: true })
  assert.equal(follows.status, 201); assert.equal(follows.body.schedule.useAgentDefaults, true)
  const own = await f.request('/api/schedules', 'POST', base)
  assert.equal(own.body.schedule.useAgentDefaults, false)
  const followed = await f.request(`/api/schedules/${follows.body.schedule.id}/run`, 'POST', {})
  assert.equal(followed.status, 201); assert.equal(followed.body.task.provider, 'claude')
  assert.ok(followed.body.task.events.some(event => /Full Access/.test(event.message)))
  await finish(followed.body.task.id)
  const fixed = await f.request(`/api/schedules/${own.body.schedule.id}/run`, 'POST', {})
  assert.equal(fixed.status, 201); assert.equal(fixed.body.task.provider, 'codex')
  await finish(fixed.body.task.id)

  // Profile edits reach following schedules on their next run; defaults survive a restart.
  await f.request('/api/agents/atlas', 'PUT', { ...atlas, provider: 'antigravity', permissionMode: 'restricted' })
  await f.stop(); await f.start()
  const agent = (await f.request('/api/state')).body.agents.find(item => item.id === 'atlas')
  assert.equal(agent.provider, 'antigravity')
  const again = await f.request(`/api/schedules/${follows.body.schedule.id}/run`, 'POST', {})
  assert.equal(again.body.task.provider, 'antigravity')
  await finish(again.body.task.id)
})

test('structured provider failures and nonzero stderr exits cannot become successful tasks', async t => {
  const f = await fixture(t, 'failure')
  for (const provider of ['codex', 'claude', 'antigravity']) {
    const { body } = await f.launch(provider)
    const task = await until(async () => { const item = await f.task(body.task.id); return item.status !== 'running' && item })
    assert.equal(task.status, 'failed'); assert.match(task.failure, /fixture failed/)
  }
  const stderr = await fixture(t, 'stderr')
  const result = await stderr.launch()
  const failed = await until(async () => { const item = await stderr.task(result.body.task.id); return item.status !== 'running' && item })
  assert.equal(failed.exitCode, 9); assert.match(failed.failure, /fixture stderr failure/)
})

test('exit zero without a completion record is reported as failure', async t => {
  const f = await fixture(t, 'empty')
  const result = await f.launch()
  const task = await until(async () => { const item = await f.task(result.body.task.id); return item.status !== 'running' && item })
  assert.equal(task.status, 'failed'); assert.match(task.failure, /without a completion event/)
})

test('continuous output persists; cancellation stops descendants; agents can share a workspace', async t => {
  const f = await fixture(t, 'hold')
  const childFolder = join(f.workspace, 'nested'); await mkdir(childFolder)
  const alias = join(f.root, 'project-alias'); await symlink(f.workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const result = await f.launch(); assert.equal(result.status, 201)
  const id = result.body.task.id
  await until(async () => { try { return (await readFile(f.tick, 'utf8')).length > 0 } catch { return false } })
  // A different agent may share the folder (nested or via alias) and is warned, not blocked.
  const parallel = await f.launch('claude', { agentId: 'nova', workspace: childFolder })
  assert.equal(parallel.status, 201)
  assert.ok(parallel.body.task.events.some(event => /Sharing this project folder/.test(event.message)))
  assert.equal((await f.launch('antigravity', { agentId: 'nova', workspace: alias })).status, 409, 'A busy agent accepted a second task')
  assert.equal((await f.launch('codex')).status, 409, 'A busy agent accepted a second task')
  assert.equal((await f.request('/api/agents/atlas', 'DELETE')).status, 409)
  assert.equal((await f.request(`/api/tasks/${parallel.body.task.id}/cancel`, 'POST')).status, 200)
  await until(async () => (await f.task(parallel.body.task.id)).status === 'cancelled')
  await until(async () => JSON.parse(await readFile(join(f.data, 'tasks.json'), 'utf8')).some(item => item.id === id && item.events.some(event => event.message.includes('progress'))))
  const cancel = await f.request(`/api/tasks/${id}/cancel`, 'POST') // Same bodyless request as the UI.
  assert.equal(cancel.status, 200)
  const task = await until(async () => { const item = await f.task(id); return item.status !== 'running' && item })
  assert.equal(task.status, 'cancelled'); assert.ok(task.finishedAt); assert.equal(task.phase, 'idle')
  const count = await readFile(f.tick, 'utf8'); await sleep(180)
  assert.equal(await readFile(f.tick, 'utf8'), count, 'Descendant must stop writing after cancellation acknowledgement')
  assert.equal((await f.request('/api/agents/atlas', 'DELETE')).status, 200)
})

test('graceful shutdown stops provider descendants and stores interrupted history', async t => {
  const f = await fixture(t, 'hold')
  const result = await f.launch()
  await until(async () => { try { return (await readFile(f.tick, 'utf8')).length > 0 } catch { return false } })
  await f.stop()
  const count = await readFile(f.tick, 'utf8'); await sleep(150)
  assert.equal(await readFile(f.tick, 'utf8'), count)
  const history = JSON.parse(await readFile(join(f.data, 'tasks.json'), 'utf8'))
  assert.equal(history.find(item => item.id === result.body.task.id).status, 'interrupted')
})

test('unreadable or malformed private stores are preserved and never silently replaced', async t => {
  for (const contents of ['[null]', '{broken', '{"not":"an array"}']) {
    const f = await fixture(t, 'success', { 'tasks.json': contents, 'agents.json': '{broken' })
    const state = (await f.request('/api/state')).body
    assert.deepEqual(state.storage, { historyReadable: false, agentsReadable: false, schedulesReadable: true, knowledgeReadable: true, historyWriteError: false })
    assert.equal((await f.launch()).status, 503)
    const create = await f.request('/api/agents', 'POST', { name:'Safe',role:'QA',specialty:'Audit',department:'quality',color:'#123456' })
    assert.equal(create.status, 500)
    await f.stop()
    assert.equal(await readFile(join(f.data, 'tasks.json'), 'utf8'), contents)
    assert.equal(await readFile(join(f.data, 'agents.json'), 'utf8'), '{broken')
    await assert.rejects(readFile(f.capture), { code: 'ENOENT' })
  }
  const rosterOnly = await fixture(t, 'success', { 'agents.json': '{broken' })
  assert.equal((await rosterOnly.launch()).status, 503, 'A corrupt roster must not silently launch a default profile')
  await assert.rejects(readFile(rosterOnly.capture), { code: 'ENOENT' })
  const schedulesOnly = await fixture(t, 'success', { 'schedules.json': '{broken' })
  assert.equal((await schedulesOnly.request('/api/state')).body.storage.schedulesReadable, false)
  const schedule = await schedulesOnly.request('/api/schedules', 'POST', { agentId: 'atlas', prompt: 'Check', workspace: schedulesOnly.workspace, provider: 'codex',
    permissionMode: 'restricted', repeat: 'daily', time: '09:00', runAt: null, intervalMinutes: null, days: null, enabled: true })
  assert.equal(schedule.status, 500, 'A corrupt schedule store must not be replaced')
  await schedulesOnly.stop()
  assert.equal(await readFile(join(schedulesOnly.data, 'schedules.json'), 'utf8'), '{broken')
  const knowledgeOnly = await fixture(t, 'success', { 'knowledge.json': '[{"id":1}]' })
  assert.equal((await knowledgeOnly.request('/api/state')).body.storage.knowledgeReadable, false)
  const note = await knowledgeOnly.request('/api/knowledge', 'POST', { workspace: knowledgeOnly.workspace, title: 'Keep', body: 'A note.' })
  assert.equal(note.status, 503, 'A corrupt knowledge store must not be replaced')
  assert.equal((await knowledgeOnly.launch()).status, 201, 'Tasks still run without team knowledge')
  await knowledgeOnly.stop()
  assert.equal(await readFile(join(knowledgeOnly.data, 'knowledge.json'), 'utf8'), '[{"id":1}]')
})

test('failed durable storage prevents a provider launch; async spawn errors release reservations', async t => {
  const f = await fixture(t)
  await mkdir(join(f.data, 'tasks.json'))
  assert.equal((await f.launch()).status, 500)
  await assert.rejects(readFile(f.capture), { code: 'ENOENT' })
  await rm(join(f.data, 'tasks.json'), { recursive: true })
  await rm(f.fake)
  const result = await f.launch(); assert.equal(result.status, 201)
  const task = await until(async () => { const item = await f.task(result.body.task.id); return item.status !== 'running' && item })
  assert.equal(task.status, 'failed'); assert.ok(task.finishedAt)
  assert.equal((await f.request('/api/agents/atlas', 'DELETE')).status, 200)
})

test('Host/Origin, missing-Origin browser requests, JSON errors and paths are validated without launching providers', async t => {
  const f = await fixture(t)
  for (const headers of [{ Origin:'https://evil.invalid' }, { Origin:'null' }, { 'Sec-Fetch-Site':'cross-site' }]) {
    assert.equal((await f.request('/api/state', 'GET', undefined, headers)).status, 403)
    assert.equal((await f.request('/api/agents/atlas', 'DELETE', undefined, headers)).status, 403)
  }
  for (const path of ['/', '/api/state', '/api/events']) {
    const status = await new Promise((done, reject) => {
      const req = http.get(f.base + path, { headers:{ Host:'evil.invalid' } }, res => { res.resume(); done(res.statusCode) })
      req.on('error', reject)
    })
    assert.equal(status, 403)
  }
  assert.equal((await f.request('/api/state', 'GET', undefined, { Origin: f.base })).status, 200)
  assert.equal((await f.request('/api/state', 'GET', undefined, { Origin:'http://localhost:5173' })).status, 200)
  const iframe = await fetch(f.base + '/', { headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Dest':'iframe','Sec-Fetch-Mode':'navigate'} })
  assert.notEqual(iframe.status, 403, 'VS Code must be able to embed the static office page')
  await iframe.body?.cancel()
  const invalid = await fetch(f.base + '/api/tasks', { method:'POST',headers:{'Content-Type':'application/json'},body:'{broken' })
  assert.equal(invalid.status, 400); assert.deepEqual(await invalid.json(), { error:'Invalid JSON body.' })
  const large = await fetch(f.base + '/api/tasks', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'x'.repeat(66000)}) })
  assert.equal(large.status, 413); assert.ok((await large.json()).error)
  const plain = await fetch(f.base + '/api/tasks', { method:'POST',headers:{'Content-Type':'text/plain'},body:'{}' })
  assert.equal(plain.status, 415)
  for (const workspace of ['relative', f.fake, f.workspace + '\0', join(f.root, 'missing')]) assert.equal((await f.launch('codex', { workspace })).status, 400)
  assert.equal((await f.launch('unknown')).status, 400)
  assert.equal((await f.request('/api/absent')).status, 404)
  await assert.rejects(readFile(f.capture), { code:'ENOENT' })
})

test('SSE streams updated state and disconnected viewers do not break mutations', async t => {
  const f = await fixture(t)
  const response = await fetch(f.base + '/api/events')
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const reader = response.body.getReader()
  const initial = new TextDecoder().decode((await reader.read()).value)
  assert.match(initial, /event: state/)
  const next = reader.read()
  const create = await f.request('/api/agents', 'POST', {name:'SSE Fixture',role:'QA',specialty:'Audit',department:'quality',color:'#123456'})
  assert.equal(create.status, 201)
  assert.match(new TextDecoder().decode((await next).value), /SSE Fixture/)
  await reader.cancel()
  assert.equal((await f.request(`/api/agents/${create.body.agent.id}`, 'DELETE')).status, 200)
})
