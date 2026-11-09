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
  assert.ok(launchArgs('gemini', '/projects/a').includes('auto_edit'))
  assert.throws(() => launchArgs('other', '/projects/a'))
})

test('permission escalation is explicit and unavailable modes are rejected', () => {
  const workspace = '/projects/a'
  assert.ok(launchArgs('codex', workspace, 'approve-for-me').includes('--approve-for-me'))
  assert.ok(launchArgs('claude', workspace, 'approve-for-me').includes('auto'))
  assert.ok(launchArgs('codex', workspace, 'full-access').includes('--dangerously-bypass-approvals-and-sandbox'))
  assert.ok(launchArgs('claude', workspace, 'full-access').includes('--dangerously-skip-permissions'))
  assert.ok(launchArgs('gemini', workspace, 'full-access').includes('--sandbox=false'))
  assert.throws(() => launchArgs('gemini', workspace, 'approve-for-me'))
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
  assert.deepEqual(launchArgs('gemini', workspace), ['-p', '--output-format', 'stream-json', '--approval-mode', 'auto_edit'])
  for (const id of ['codex', 'claude', 'gemini']) {
    const command = providerCommand({ id, bin: '/fake/provider.cjs' }, workspace, prompt)
    assert.equal(command.command, process.execPath)
    assert.equal(command.args[0], '/fake/provider.cjs')
    assert.equal(command.input, id === 'gemini' ? '' : prompt)
    if (id === 'gemini') assert.equal(command.args[2], prompt)
  }
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
  for (const provider of ['codex', 'claude', 'gemini']) {
    const task = { provider, lastMessage: '' }
    for (const value of [null, [], 1, { type: 'assistant', message: { content: {} } }, { type: 'assistant', message: { content: [null, 1] } }]) {
      assert.doesNotThrow(() => parseMessage(task, value, add))
    }
  }
  const claude = { provider: 'claude' }
  parseMessage(claude, { type: 'result', subtype: 'error_max_turns', errors: ['Turn limit'] }, add)
  assert.equal(claude.failure, 'Turn limit'); assert.equal(claude.outputComplete, true)
  const gemini = { provider: 'gemini', lastMessage: '' }
  parseMessage(gemini, { type: 'error', message: 'retrying' }, add)
  parseMessage(gemini, { type: 'message', role: 'assistant', content: 'Hello ', delta: true }, add)
  parseMessage(gemini, { type: 'message', role: 'assistant', content: 'world', delta: true }, add)
  parseMessage(gemini, { type: 'result', status: 'success', stats: { total_tokens: 4 } }, add)
  assert.equal(gemini.lastMessage, 'Hello world'); assert.equal(gemini.failure, undefined)
  assert.deepEqual(gemini.usage, { total_tokens: 4 })
  const codex = { provider: 'codex' }
  parseMessage(codex, { type: 'error', message: 'retrying' }, add)
  parseMessage(codex, { type: 'turn.completed' }, add)
  assert.equal(codex.failure, undefined); assert.equal(codex.outputComplete, true)
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
    assert.equal(list.find(item => item.id === 'gemini').available, false)
    assert.equal(list.find(item => item.id === 'claude').bin, join(claude, 'claude.exe'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
