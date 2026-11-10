import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, parse } from 'node:path'
import { discoverProviders, foldersOverlap, launchArgs, providerCommand } from '../server/providers.mjs'
import { jsonLines, parseMessage } from '../server/task-output.mjs'

test('supports three CLI choices and safe launch arguments', () => {
  assert.equal(launchArgs('codex', '/projects/a')[0], 'exec')
  assert.ok(launchArgs('claude', '/projects/a').includes('stream-json'))
  assert.ok(launchArgs('antigravity', '/projects/a').includes('accept-edits'))
  assert.throws(() => launchArgs('gemini', '/projects/a'), 'Gemini CLI was replaced by Antigravity CLI')
  assert.throws(() => launchArgs('other', '/projects/a'))
})

test('permission escalation is explicit and unavailable modes are rejected', () => {
  const workspace = '/projects/a'
  assert.ok(launchArgs('codex', workspace, 'approve-for-me').includes('--approve-for-me'))
  assert.ok(launchArgs('claude', workspace, 'approve-for-me').includes('auto'))
  assert.ok(launchArgs('codex', workspace, 'full-access').includes('--dangerously-bypass-approvals-and-sandbox'))
  assert.ok(launchArgs('claude', workspace, 'full-access').includes('--dangerously-skip-permissions'))
  assert.ok(launchArgs('antigravity', workspace, 'full-access').includes('--dangerously-skip-permissions'))
  assert.ok(!launchArgs('antigravity', workspace).includes('--dangerously-skip-permissions'))
  assert.throws(() => launchArgs('antigravity', workspace, 'approve-for-me'))
  assert.throws(() => launchArgs('codex', workspace, 'ask'))
  assert.throws(() => launchArgs('codex', workspace, true))
})

test('rejects concurrent tasks in matching or nested folders', () => {
  const root = join(tmpdir(), 'case-project')
  assert.equal(foldersOverlap(root, root), true)
  assert.equal(foldersOverlap(root, join(root, 'src')), true)
  assert.equal(foldersOverlap(join(root, 'src'), root), true)
  assert.equal(foldersOverlap(root, root + '-another'), false)
  assert.equal(foldersOverlap('C:\\Projects\\Demo', 'c:\\projects\\demo', 'win32'), true)
  assert.equal(foldersOverlap(parse(root).root, root), true, 'Filesystem root overlaps descendants')
  assert.equal(foldersOverlap('C:\\', 'C:\\Projects', 'win32'), true)
  assert.equal(foldersOverlap('C:/Projects/', 'c:\\projects\\demo', 'win32'), true)
  assert.equal(foldersOverlap('C:\\Projects', 'D:\\Projects', 'win32'), false)
})

test('discovery rejects directories and broken overrides and continues past broken PATH shims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-office-discovery-'))
  try {
    const first = join(root, 'first'), second = join(root, 'second')
    await mkdir(first); await mkdir(second)
    await mkdir(join(first, 'codex.exe'))
    await writeFile(join(first, 'codex.cmd'), '')
    await writeFile(join(second, 'codex.exe'), '')
    const env = { PATH: [first, second].join(delimiter) }
    assert.equal(discoverProviders(env, 'win32')[0].bin, join(second, 'codex.exe'))
    assert.equal(discoverProviders({ ...env, CODEX_BIN: first }, 'win32')[0].available, false)
    assert.equal(discoverProviders({ ...env, CODEX_BIN: 'codex' }, 'win32')[0].available, false)
    await writeFile(join(root, 'shim.cmd'), '')
    const legacy = join(root, 'node_modules', '@anthropic-ai', 'claude-code')
    await mkdir(legacy, { recursive: true }); await writeFile(join(legacy, 'cli.js'), '')
    assert.equal(discoverProviders({ CLAUDE_BIN: join(root, 'shim.cmd') }, 'win32')[1].bin, join(legacy, 'cli.js'))
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'agent-office-discovery-'))); await rm(root, { recursive: true, force: true }) }
})

test('provider argv keeps flags exact and separates shell metacharacters from commands', () => {
  const workspace = join(tmpdir(), 'project & literal')
  const prompt = 'Quotes " and & ; $(literal)\nSecond line'
  assert.deepEqual(launchArgs('codex', workspace), ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', workspace, '-'])
  assert.deepEqual(launchArgs('claude', workspace), ['--print', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none'])
  assert.deepEqual(launchArgs('antigravity', workspace), ['--output-format', 'stream-json', '--disable-slash-commands', '--mode', 'accept-edits'])
  for (const id of ['codex', 'claude', 'antigravity']) {
    const command = providerCommand({ id, bin: '/fake/provider.cjs' }, workspace, prompt)
    assert.equal(command.command, process.execPath)
    assert.equal(command.args[0], '/fake/provider.cjs')
    assert.equal(command.input, id === 'antigravity' ? '' : prompt)
    if (id === 'antigravity') assert.equal(command.args[1], `--print=${prompt}`)
  }
  // A prompt that looks like a flag stays the --print value.
  assert.equal(providerCommand({ id: 'antigravity', bin: '/usr/bin/agy' }, workspace, '--help').args[0], '--print=--help')
})

test('JSONL preserves fragmented UTF-8 text, CRLF and final records, and recovers after oversized lines', () => {
  const values = [], warnings = []
  const reader = jsonLines(value => values.push(value), () => warnings.push(true), 80)
  reader.push('{"text":"Hello'); reader.push(' 👩"}\r\nplain diagnostics\n')
  reader.push('x'.repeat(90)); reader.push('\n{"type":"turn.completed"}')
  reader.end()
  assert.deepEqual(values, [{ text: 'Hello 👩' }, { type: 'turn.completed' }])
  assert.equal(warnings.length, 1)
  const bulk = jsonLines(value => values.push(value), undefined, 40)
  bulk.push(Array.from({ length: 30 }, () => '{"ok":true}\n').join(''))
  assert.equal(values.length, 32, 'Record limits must not drop valid lines in a large chunk')
})

test('provider parsers accept malformed shapes, expose terminal errors and retain recoverable diagnostics', () => {
  const events = []
  const add = (_task, message) => events.push(message)
  for (const provider of ['codex', 'claude', 'antigravity']) {
    const task = { provider, lastMessage: '' }
    for (const value of [null, [], 1, { type: 'assistant', message: { content: {} } }, { type: 'assistant', message: { content: [null, 1] } }]) {
      assert.doesNotThrow(() => parseMessage(task, value, add))
    }
  }
  const claude = { provider: 'claude' }
  parseMessage(claude, { type: 'result', subtype: 'error_max_turns', errors: ['Turn limit'] }, add)
  assert.equal(claude.failure, 'Turn limit'); assert.equal(claude.outputComplete, true)
  // Shapes captured from agy 1.5.4 stream-json output.
  const agy = { provider: 'antigravity', lastMessage: '', events: [] }
  const log = (task, message, kind = 'info') => task.events.push([kind, message])
  const step = (step_index, state, extra) => ({ event: 'step_update', step_update: { conversation_id: 'c1', step_index, state, ...extra } })
  parseMessage(agy, { event: 'init', conversation_id: 'c1', init: { cwd: '/p', tools: ['read_file'], permission_mode: 'request-review' } }, log)
  parseMessage(agy, step(0, 'DONE', { step_type: 'user_input' }), log)
  parseMessage(agy, step(1, 'DONE', { step_type: 'agent_response', usage: { total_tokens: 3 } }), log)
  parseMessage(agy, step(2, 'ACTIVE', { step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: {} } }), log)
  parseMessage(agy, step(2, 'DONE', { step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', output: '1 lines' } }), log)
  parseMessage(agy, step(3, 'ACTIVE', { step_type: 'agent_response', text_delta: 'Hello ' }), log)
  parseMessage(agy, step(3, 'DONE', { step_type: 'agent_response', text_delta: 'world\n' }), log)
  parseMessage(agy, { event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: 'Hello world\n', usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } } }, log)
  assert.equal(agy.threadId, 'c1'); assert.equal(agy.lastMessage, 'Hello world '); assert.equal(agy.failure, undefined)
  assert.equal(agy.outputComplete, true); assert.deepEqual(agy.usage, { input_tokens: 2, output_tokens: 2, total_tokens: 4 })
  assert.deepEqual(agy.events, [['info', 'Antigravity used read_file.'], ['info', 'Antigravity replied: Hello world']])
  // Soft-denied approvals exit 0 with SUCCESS, so they must still surface as an error event.
  const denied = { provider: 'antigravity', lastMessage: '', events: [] }
  parseMessage(denied, step(2, 'ACTIVE', { step_type: 'tool', tool_name: 'run_command' }), log)
  parseMessage(denied, step(2, 'ERROR', { step_type: 'tool', tool_name: 'run_command', tool_info: { error: { type: 'TOOL_ERROR', message: 'permission check failed' } } }), log)
  parseMessage(denied, { event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } }, log)
  assert.equal(denied.failure, undefined)
  assert.deepEqual(denied.events.map(([kind]) => kind), ['info', 'error', 'error'])
  assert.match(denied.events[2][1], /skipped actions that required approval \(RunCommand\)/)
  const failed = { provider: 'antigravity', lastMessage: '' }
  parseMessage(failed, { event: 'result', result: { status: 'ERROR', error: 'quota exceeded' } }, add)
  assert.equal(failed.failure, 'quota exceeded'); assert.equal(failed.outputComplete, true)
  const interrupted = { provider: 'antigravity', lastMessage: '' }
  parseMessage(interrupted, { event: 'result', result: { status: 'INTERRUPTED' } }, add)
  assert.match(interrupted.failure, /status INTERRUPTED/)
  const codex = { provider: 'codex' }
  parseMessage(codex, { type: 'error', message: 'retrying' }, add)
  parseMessage(codex, { type: 'turn.completed' }, add)
  assert.equal(codex.failure, undefined); assert.equal(codex.outputComplete, true)

  const mcp = { provider: 'codex', events: [] }
  const record = (task, message) => task.events.push(message)
  parseMessage(mcp, { type: 'item.started', item: { type: 'mcp_tool_call', server: 'graphify', tool: 'query_graph' } }, record)
  parseMessage(mcp, { type: 'item.updated', item: { type: 'mcp_tool_call', server: 'graphify', tool: 'query_graph' } }, record)
  assert.deepEqual(mcp.events, ['Starting graphify tool: query_graph']); assert.equal(mcp.phase, 'researching')
})

test('detects CLI binaries without invoking a shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-office-providers-'))
  try {
    await writeFile(join(root, 'codex.exe'), '')
    await writeFile(join(root, 'claude.cmd'), '')
    const claude = join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'bin')
    await mkdir(claude, { recursive: true })
    await writeFile(join(claude, 'claude.exe'), '')
    const list = discoverProviders({ PATH: root + delimiter }, 'win32')
    assert.equal(list.find(item => item.id === 'codex').available, true)
    assert.equal(list.find(item => item.id === 'claude').available, true)
    assert.equal(list.find(item => item.id === 'antigravity').available, false)
    assert.equal(list.some(item => item.id === 'gemini'), false)
    assert.equal(list.find(item => item.id === 'claude').bin, join(claude, 'claude.exe'))
    await writeFile(join(root, 'agy.exe'), '')
    assert.equal(discoverProviders({ PATH: root }, 'win32').find(item => item.id === 'antigravity').bin, join(root, 'agy.exe'), 'Antigravity is found by its agy command name')
  } finally { await rm(root, { recursive: true, force: true }) }
})
