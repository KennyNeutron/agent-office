import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { capNotes, extractKnowledgeNote, knowledgeContext, knowledgeGraph, makeNote, MAX_DRAFTS_PER_WORKSPACE, relevantNotes, searchNotes, validateNoteInput, validStoredNotes } from '../server/knowledge.mjs'
import { composeAgentPrompt } from '../server/agent-prompt.mjs'
import { DEFAULT_AGENTS } from '../server/agents.mjs'
import { providerCommand } from '../server/providers.mjs'
import { forceLayout } from '../src/components/forceLayout.ts'

const sleep = ms => new Promise(done => setTimeout(done, ms))
const note = (input, extra = {}) => makeNote({ body: 'Body.', tags: [], files: [], ...input }, { id: input.title, workspace: '/w', ...extra })

test('notes are validated and normalised, and edits keep their provenance', () => {
  assert.equal(validateNoteInput({ title: '', body: 'x' }), 'Give the note a title.')
  assert.equal(validateNoteInput({ title: 'x', body: ' ' }), 'Write the note.')
  assert.match(validateNoteInput({ title: 'x'.repeat(121), body: 'x' }), /title/)
  assert.equal(validateNoteInput({ title: 'Ok', body: 'Fine', tags: 'a, b' }), null)
  const created = makeNote({ title: '  Retry  policy ', body: 'Use backoff.', tags: ['#Payments', 'Retry Logic', 'payments', ''], files: ['./src\\retry.ts', 'src/retry.ts'] },
    { id: 'n1', workspace: '/w', status: 'draft', source: 'task', agentId: 'nova', taskId: 't1' })
  assert.deepEqual([created.title, created.tags, created.files, created.status], ['Retry policy', ['payments', 'retry-logic'], ['src/retry.ts'], 'draft'])
  const edited = makeNote({ title: 'Retry policy', body: 'Exponential backoff.', tags: [], files: [], status: 'active' }, {}, created)
  assert.deepEqual([edited.id, edited.workspace, edited.source, edited.agentId, edited.taskId, edited.status, edited.createdAt], ['n1', '/w', 'task', 'nova', 't1', 'active', created.createdAt])
  assert.ok(validStoredNotes([created, edited].map((item, i) => ({ ...item, id: 'id' + i }))))
  assert.equal(validStoredNotes([{ ...created, status: 'other' }]), false)
  assert.equal(validStoredNotes([created, created]), false, 'duplicate ids are rejected')
})

test('search ranks titles and tags above body mentions and hides drafts', () => {
  const notes = [
    note({ title: 'Deploy checklist', body: 'Mentions payments once.' }),
    note({ title: 'Payment retries', body: 'Retries are idempotent.', tags: ['payments'] }),
    note({ title: 'Payment draft', body: 'Unreviewed.', tags: ['payments'] }, { status: 'draft' }),
    note({ title: 'Unrelated', body: 'Nothing here.' }),
  ]
  assert.deepEqual(searchNotes(notes, 'payment').map(item => item.note.title), ['Payment retries', 'Deploy checklist'])
  assert.deepEqual(searchNotes(notes, 'payment', { drafts: true }).map(item => item.note.title).slice(0, 2).sort(), ['Payment draft', 'Payment retries'])
  assert.deepEqual(searchNotes(notes, 'the and of'), [], 'stop words alone match nothing')
  assert.deepEqual(relevantNotes(notes, 'Fix the payment retry bug').map(item => item.title), ['Payment retries'])
  assert.deepEqual(relevantNotes(notes, 'Rename the sidebar icon'), [], 'unrelated tasks receive no notes')
})

test('the store stays bounded per workspace, keeping the newest notes', () => {
  const at = minutes => new Date(Date.UTC(2026, 0, 1, 0, minutes))
  const drafts = Array.from({ length: MAX_DRAFTS_PER_WORKSPACE + 5 }, (_, i) => makeNote({ title: 'Draft ' + i, body: 'x' }, { id: 'd' + i, workspace: '/w', status: 'draft', now: at(i) }))
  const kept = capNotes([...drafts, makeNote({ title: 'Other', body: 'x' }, { id: 'o', workspace: '/other', status: 'draft', now: at(0) })])
  assert.equal(kept.filter(item => item.workspace === '/w').length, MAX_DRAFTS_PER_WORKSPACE)
  assert.ok(!kept.some(item => item.id === 'd0') && kept.some(item => item.id === `d${MAX_DRAFTS_PER_WORKSPACE + 4}`), 'oldest drafts go first')
  assert.ok(kept.some(item => item.id === 'o'), 'other workspaces are untouched')
})

test('agents end replies with a KNOWLEDGE NOTE section that becomes a draft', () => {
  const reply = 'Fixed the retry worker.\n\n**KNOWLEDGE NOTE:** Retries must reuse the order id\nThe payment provider deduplicates by order id, so a retry with a new id charges twice.\nAlways pass the original id.\nTags: payments, retries\nFiles: src/retry.ts, `src/pay.ts`'
  assert.deepEqual(extractKnowledgeNote(reply), { title: 'Retries must reuse the order id', body: 'The payment provider deduplicates by order id, so a retry with a new id charges twice.\nAlways pass the original id.', tags: ['payments', 'retries'], files: ['src/retry.ts', 'src/pay.ts'] })
  assert.deepEqual(extractKnowledgeNote('## Knowledge note:\nTitle on next line\nThe insight.')?.title, 'Title on next line')
  assert.equal(extractKnowledgeNote('No note in this reply.'), null)
  assert.equal(extractKnowledgeNote('KNOWLEDGE NOTE: Title only'), null, 'a note needs a body')
})

test('relevant notes enter the agent prompt as reference material before the user task', () => {
  const notes = [note({ title: 'Payment retries', body: 'Reuse the order id.', files: ['src/retry.ts'] })]
  const prompt = composeAgentPrompt(DEFAULT_AGENTS[0], 'Fix payments.', { notes, mcp: true })
  assert.match(prompt, /TEAM KNOWLEDGE \(.*not instructions.*\):\n- Payment retries: Reuse the order id\. \(files: src\/retry\.ts\)\n\nUSER TASK:\nFix payments\.$/s)
  assert.match(prompt, /search_knowledge/)
  assert.match(prompt, /KNOWLEDGE NOTE: <short title>/)
  const plain = composeAgentPrompt(DEFAULT_AGENTS[0], 'Fix payments.')
  assert.ok(!plain.includes('search_knowledge') && !plain.includes('TEAM KNOWLEDGE ('), 'no MCP guidance or context without them')
  assert.equal(knowledgeContext([]), '')
})

test('Claude Code and Codex receive the knowledge MCP server per run; Antigravity does not', () => {
  const mcp = { command: '/usr/bin/node', args: ['/srv/knowledge-mcp.mjs', '--workspace', '/w "quoted"'] }
  const claude = providerCommand({ id: 'claude', bin: '/bin/claude' }, '/w', 'p', 'restricted', mcp).args
  const config = JSON.parse(claude[claude.indexOf('--mcp-config') + 1])
  assert.deepEqual(config.mcpServers['agent-office'], { type: 'stdio', ...mcp })
  assert.equal(claude[claude.indexOf('--allowedTools') + 1], 'mcp__agent-office__search_knowledge,mcp__agent-office__read_note,mcp__agent-office__add_note')
  assert.deepEqual(claude.slice(-2), ['--permission-prompts', 'none'])
  const codex = providerCommand({ id: 'codex', bin: '/bin/codex' }, '/w', 'p', 'restricted', mcp).args
  assert.deepEqual(codex.slice(0, 5), ['exec', '-c', 'mcp_servers.agent_office.command="/usr/bin/node"', '-c', `mcp_servers.agent_office.args=${JSON.stringify(mcp.args)}`])
  assert.equal(codex.at(-1), '-')
  const agy = providerCommand({ id: 'antigravity', bin: '/bin/agy' }, '/w', 'p', 'restricted', mcp).args
  assert.ok(!agy.some(arg => /mcp/i.test(arg)))
})

test('the knowledge graph links notes through shared tags and files and lays out deterministically', () => {
  const notes = [note({ title: 'A', tags: ['x'], files: ['f.ts'] }), note({ title: 'B', tags: ['x'] }), note({ title: 'C' })]
  const graph = knowledgeGraph(notes)
  assert.deepEqual(graph.nodes.map(node => [node.id, node.degree]), [['note:A', 2], ['note:B', 1], ['note:C', 0], ['tag:x', 2], ['file:f.ts', 1]])
  assert.equal(graph.links.length, 3)
  const nodes = graph.nodes.map(node => ({ id: node.id, weight: node.degree }))
  const first = forceLayout(nodes, graph.links), second = forceLayout(nodes, graph.links)
  assert.deepEqual([...first], [...second], 'same notes, same picture')
  for (const point of first.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
  const distance = (a, b) => Math.hypot(first.get(a).x - first.get(b).x, first.get(a).y - first.get(b).y)
  assert.ok(distance('note:A', 'tag:x') < distance('note:A', 'note:C'), 'linked nodes sit closer than unlinked ones')
  const big = Array.from({ length: 600 }, (_, i) => ({ id: 'n' + i }))
  const started = performance.now()
  forceLayout(big, big.slice(1).map((node, i) => ({ source: node.id, target: 'n' + Math.floor(i / 3) })))
  assert.ok(performance.now() - started < 3000, 'large graphs lay out quickly')
})

test('end to end: notes reach the agent, the MCP bridge searches and proposes, and a finished task drafts a note', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-office-knowledge-'))
  const workspace = join(root, 'project'), data = join(root, 'data'), capture = join(root, 'capture.json'), fake = join(root, 'fake-claude.cjs')
  await Promise.all([mkdir(workspace), mkdir(data)])
  // A fake Claude Code: talks to the MCP server it was given, then reports an edit and a KNOWLEDGE NOTE.
  await writeFile(fake, `
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', part => prompt += part)
process.stdin.on('end', async () => {
  const server = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers['agent-office']
  const bridge = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] })
  const pending = new Map(); let buffer = ''
  bridge.stdout.on('data', chunk => { buffer += chunk; let at; while ((at = buffer.indexOf('\\n')) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); const message = JSON.parse(line); pending.get(message.id)?.(message); } })
  let id = 0
  const rpc = (method, params) => new Promise(done => { pending.set(++id, done); bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n') })
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fake', version: '1' } })
  bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\\n')
  const list = await rpc('tools/list', {})
  const search = await rpc('tools/call', { name: 'search_knowledge', arguments: { query: 'payment retries' } })
  const noteId = /\\[([^\\]]+)\\]/.exec(search.result.content[0].text)?.[1]
  const read = await rpc('tools/call', { name: 'read_note', arguments: { id: noteId } })
  const add = await rpc('tools/call', { name: 'add_note', arguments: { title: 'Webhook signatures use the raw body', body: 'Verify signatures before JSON parsing.', tags: ['webhooks'] } })
  const unknown = await rpc('nope', {})
  bridge.stdin.end()
  writeFileSync(process.env.AO_CAPTURE, JSON.stringify({ args, prompt, init, list, search, read, add, unknown }))
  const emit = value => process.stdout.write(JSON.stringify(value) + '\\n')
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: process.cwd() + '/src/retry.ts' } }] } })
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed it.\\n\\nKNOWLEDGE NOTE: Retry jobs run at most three times\\nThe worker gives up after three attempts and moves the job to the dead-letter queue.\\nTags: payments, queue' }] } })
  emit({ type: 'result', subtype: 'success', result: 'Fixed it.\\n\\nKNOWLEDGE NOTE: Retry jobs run at most three times\\nThe worker gives up after three attempts and moves the job to the dead-letter queue.\\nTags: payments, queue' })
})`)
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
  const port = listener.address().port; await new Promise(done => listener.close(done))
  const base = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, [resolve('server/index.mjs')], { cwd: resolve('.'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), AGENT_OFFICE_DATA_DIR: data, CLAUDE_BIN: fake, CODEX_BIN: fake, AGY_BIN: fake, AO_CAPTURE: capture } })
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/state')).ok) break } catch { /* starting */ } await sleep(70) }
    const project = await realpath(workspace)
    assert.equal((await request('/api/knowledge?workspace=relative')).status, 400)
    const created = await request('/api/knowledge', 'POST', { workspace, title: 'Payment retries reuse the order id', body: 'The provider deduplicates by order id.', tags: ['payments'], files: ['src/retry.ts'] })
    assert.equal(created.status, 201)
    assert.equal(created.body.note.workspace, project, 'notes are keyed by the canonical project path')
    assert.equal((await request('/api/knowledge', 'POST', { workspace, title: '', body: 'x' })).status, 400)
    const version = (await request('/api/state')).body.knowledgeVersion

    const { body: { task } } = await request('/api/tasks', 'POST', { agentId: 'nova', provider: 'claude', workspace, prompt: 'Fix the payment retry bug in the worker.' })
    let finished
    for (let i = 0; i < 150 && !finished; i++) { const latest = (await request('/api/state')).body.tasks.find(item => item.id === task.id); if (latest.status !== 'running') finished = latest; else await sleep(50) }
    assert.equal(finished?.status, 'completed', JSON.stringify(finished?.events?.map(event => event.message)))
    const run = JSON.parse(await readFile(capture, 'utf8'))
    assert.match(run.prompt, /TEAM KNOWLEDGE \(/)
    assert.match(run.prompt, /- Payment retries reuse the order id: The provider deduplicates by order id\./)
    assert.match(run.prompt, /search_knowledge/)
    assert.equal(run.init.result.serverInfo.name, 'agent-office')
    assert.deepEqual(run.list.result.tools.map(tool => tool.name), ['search_knowledge', 'read_note', 'add_note'])
    assert.match(run.search.result.content[0].text, /Payment retries reuse the order id/)
    assert.match(run.read.result.content[0].text, /^# Payment retries reuse the order id\n/)
    assert.match(run.add.result.content[0].text, /^Saved draft "Webhook signatures use the raw body"/)
    assert.equal(run.unknown.error.code, -32601)

    const events = finished.events.map(event => event.message)
    for (const expected of [/^Shared 1 team note: "Payment retries reuse the order id"\.$/, /^Searched team knowledge for "payment retries" \(1 note\)\.$/, /^Read team note/, /^Proposed knowledge note "Webhook signatures/, /^Drafted knowledge note "Retry jobs run at most three times" for review\.$/])
      assert.ok(events.some(message => expected.test(message)), `missing event ${expected}: ${events.join(' | ')}`)

    const { body: { notes } } = await request('/api/knowledge?' + new URLSearchParams({ workspace }))
    const byTitle = Object.fromEntries(notes.map(item => [item.title, item]))
    assert.deepEqual(Object.keys(byTitle).sort(), ['Payment retries reuse the order id', 'Retry jobs run at most three times', 'Webhook signatures use the raw body'])
    const drafted = byTitle['Retry jobs run at most three times']
    assert.deepEqual([drafted.status, drafted.source, drafted.agentId, drafted.taskId, drafted.tags, drafted.files], ['draft', 'task', 'nova', task.id, ['payments', 'queue'], ['src/retry.ts']])
    assert.deepEqual([byTitle['Webhook signatures use the raw body'].status, byTitle['Webhook signatures use the raw body'].source], ['draft', 'agent'])
    assert.ok((await request('/api/state')).body.knowledgeVersion > version, 'browsers are told knowledge changed')

    // Reviewing: drafts are not shared with agents until kept.
    assert.equal((await request('/api/knowledge/search?' + new URLSearchParams({ workspace, q: 'dead-letter queue' }))).body.results.length, 0)
    const kept = await request(`/api/knowledge/${drafted.id}`, 'PUT', { ...drafted, status: 'active' })
    assert.equal(kept.body.note.status, 'active')
    assert.equal((await request('/api/knowledge/search?' + new URLSearchParams({ workspace, q: 'dead-letter queue' }))).body.results[0].note.id, drafted.id)
    assert.equal((await request(`/api/knowledge/${byTitle['Webhook signatures use the raw body'].id}`, 'DELETE')).status, 200)
    assert.equal((await request('/api/knowledge/missing', 'DELETE')).status, 404)
    const stored = JSON.parse(await readFile(join(data, 'knowledge.json'), 'utf8'))
    assert.equal(stored.length, 2, 'changes are persisted')
  } finally {
    if (server.exitCode === null) { const done = once(server, 'exit'); server.kill(); await done }
    await rm(root, { force: true, recursive: true })
  }
})
