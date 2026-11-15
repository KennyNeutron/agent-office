import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { claudeAllowedTools, claudeMcpConfig, codexMcpOverrides, makeMcpServer, mcpForAgent, publicMcpServer, validStoredMcp, validateMcpInput } from '../server/mcp.mjs'
import { providerCommand, userMcpArgs } from '../server/providers.mjs'
import { chatCommand } from '../server/chat.mjs'
import { lastJson, parseCatalog, parseInstalled, pendingCommand, pluginArgs, searchCatalog, validTarget } from '../server/plugins.mjs'
import { parseMcpJson } from '../src/components/mcpImport.ts'

const sleep = ms => new Promise(done => setTimeout(done, ms))
const stdio = { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'secret-1' }, agents: 'all' }
const http = { name: 'docs', transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret-2' }, agents: ['nova'], autoApprove: false }

test('MCP server input is validated', () => {
  assert.equal(validateMcpInput(stdio), null)
  assert.equal(validateMcpInput(http), null)
  assert.match(validateMcpInput({ ...stdio, name: 'agent-office' }), /knowledge/)
  assert.match(validateMcpInput({ ...stdio, name: 'has space' }), /letters/)
  assert.match(validateMcpInput({ ...stdio, command: '' }), /command/)
  assert.match(validateMcpInput({ ...http, url: 'ftp://example.com' }), /http/)
  assert.match(validateMcpInput({ ...stdio, env: { 'BAD-KEY': 'x' } }), /variable name/)
  assert.match(validateMcpInput({ ...http, headers: { Authorization: 'a\nb' } }), /invalid/)
  assert.match(validateMcpInput({ ...stdio, agents: 'some' }), /agents/)
  assert.match(validateMcpInput(stdio, { servers: [{ id: 'other', name: 'GitHub' }] }), /already/)
})

test('saved secrets are kept on edit and never sent to the browser', () => {
  const saved = makeMcpServer(stdio, { id: 'a' })
  const kept = makeMcpServer({ ...stdio, env: { GITHUB_TOKEN: null, EXTRA: 'new' } }, { id: 'a', previous: saved })
  assert.deepEqual(kept.env, { GITHUB_TOKEN: 'secret-1', EXTRA: 'new' })
  assert.deepEqual(makeMcpServer({ ...stdio, env: {} }, { id: 'a', previous: saved }).env, {}, 'Removed keys are deleted')
  const visible = publicMcpServer(kept)
  assert.equal(JSON.stringify(visible).includes('secret-1'), false)
  assert.deepEqual(visible.envKeys, ['GITHUB_TOKEN', 'EXTRA'])
  assert.ok(validStoredMcp([saved, makeMcpServer(http, { id: 'b' })]))
  assert.equal(validStoredMcp([saved, { ...saved, id: 'c' }]), false, 'Duplicate names are rejected')
})

test('servers apply to their agents and become per-run CLI config', () => {
  const servers = [makeMcpServer(stdio, { id: 'a' }), makeMcpServer(http, { id: 'b' }), makeMcpServer({ ...stdio, name: 'off', enabled: false }, { id: 'c' })]
  assert.deepEqual(mcpForAgent(servers, 'atlas').map(server => server.name), ['github'])
  assert.deepEqual(mcpForAgent(servers, 'nova').map(server => server.name), ['github', 'docs'])
  const assigned = mcpForAgent(servers, 'nova')
  assert.deepEqual(claudeMcpConfig(assigned).mcpServers.docs, { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret-2' } })
  assert.deepEqual(claudeAllowedTools(assigned), ['mcp__github'], 'Only auto-approved servers are pre-allowed')

  const codex = codexMcpOverrides(assigned)
  assert.equal(codex.args.join(' ').includes('secret'), false, 'Secrets never go on the command line')
  assert.ok(codex.args.includes('mcp_servers.github.env_vars=["GITHUB_TOKEN"]'))
  assert.ok(codex.args.includes('mcp_servers.github.default_tools_approval_mode="approve"'))
  assert.ok(codex.args.includes('mcp_servers.docs.env_http_headers={"Authorization"="AGENT_OFFICE_MCP_1_H0"}'))
  assert.deepEqual(codex.env, { GITHUB_TOKEN: 'secret-1', AGENT_OFFICE_MCP_1_H0: 'Bearer secret-2' })
  const clash = codexMcpOverrides([makeMcpServer(stdio, { id: 'a' }), makeMcpServer({ ...stdio, name: 'other', env: { GITHUB_TOKEN: 'different' } }, { id: 'd' })])
  assert.deepEqual(clash.skipped, ['other'])
})

test('user MCP arguments follow the knowledge server without changing it', () => {
  const knowledge = { command: '/usr/bin/node', args: ['/k.mjs'] }
  const servers = { configFile: '/data/runs/t.mcp.json', allowedTools: ['mcp__github'], codexArgs: ['-c', 'mcp_servers.github.command="npx"'] }
  const claude = providerCommand({ id: 'claude', bin: '/bin/claude' }, '/w', 'p', 'restricted', knowledge, servers).args
  assert.equal(claude[claude.indexOf('--allowedTools') + 1], 'mcp__agent-office__search_knowledge,mcp__agent-office__read_note,mcp__agent-office__add_note,mcp__github')
  assert.deepEqual(claude.filter((arg, i) => claude[i - 1] === '--mcp-config').at(-1), '/data/runs/t.mcp.json')
  assert.equal(claude.at(-1), 'none', 'Claude options stay before --permission-prompts none')
  const codex = providerCommand({ id: 'codex', bin: '/bin/codex' }, '/w', 'p', 'restricted', knowledge, servers).args
  assert.deepEqual(codex.slice(0, 5), ['exec', '-c', 'mcp_servers.agent_office.command="/usr/bin/node"', '-c', 'mcp_servers.agent_office.args=["/k.mjs"]'])
  assert.deepEqual(codex.slice(5, 7), servers.codexArgs)
  assert.deepEqual(userMcpArgs('antigravity', servers), [])
  const chat = chatCommand({ id: 'claude', bin: '/bin/claude' }, '/w', 'hi', userMcpArgs('claude', servers)).args
  assert.ok(chat.includes('--disallowedTools') && chat.includes('/data/runs/t.mcp.json'))
  assert.equal(chat.at(-1), 'none')
})

test('plugin commands never treat user input as an option', () => {
  assert.equal(validTarget('github@claude-plugins-official'), true)
  assert.equal(validTarget('/home/me/my plugin'), true)
  for (const bad of ['--help', '-y', '', ' ', 'a\nb', 'a\0b', 7]) assert.equal(validTarget(bad), false, JSON.stringify(bad))
  assert.deepEqual(pluginArgs('claude', 'install', 'x@m'), ['plugin', 'install', 'x@m', '--json', '-s', 'user'])
  assert.deepEqual(pluginArgs('claude', 'install', 'x@m', { acceptCommand: 'a'.repeat(64) }).slice(-2), ['--accept-command', 'a'.repeat(64)])
  assert.ok(!pluginArgs('claude', 'install', 'x@m', { acceptCommand: 'nope' }).includes('--accept-command'))
  assert.deepEqual(pluginArgs('claude', 'uninstall', 'x@m', { scope: 'project' }), ['plugin', 'uninstall', 'x@m', '--json', '-s', 'project'])
  assert.deepEqual(pluginArgs('codex', 'install', 'gmail@curated'), ['plugin', 'add', 'gmail@curated', '--json'])
  assert.equal(pluginArgs('codex', 'enable', 'x'), null)
  assert.deepEqual(pluginArgs('antigravity', 'install', '/plugins/demo'), ['plugin', 'install', '/plugins/demo'])
})

test('plugin listings from each CLI are normalized', () => {
  const claude = JSON.stringify({ installed: [{ id: 'a@m', version: '1.0', scope: 'user', enabled: false }],
    available: [{ pluginId: 'a@m', name: 'a', description: 'A', marketplaceName: 'm', installCount: 5 }, { pluginId: 'b@m', name: 'b', description: 'Bee tools', marketplaceName: 'm', installCount: 90 }] })
  assert.deepEqual(parseInstalled('claude', claude), [{ id: 'a@m', name: 'a', marketplace: 'm', version: '1.0', enabled: false, scope: 'user', description: '' }])
  const catalog = parseCatalog('claude', claude)
  assert.equal(catalog.find(item => item.id === 'a@m').installed, true)
  assert.deepEqual(searchCatalog(catalog, '').plugins.map(item => item.id), ['b@m', 'a@m'], 'Most installed first')
  assert.deepEqual(searchCatalog(catalog, 'bee').plugins.map(item => item.id), ['b@m'])
  const codex = JSON.stringify({ installed: [{ pluginId: 'pdf@rt', name: 'pdf', marketplaceName: 'rt', version: '2', installed: true, enabled: true }] })
  assert.equal(parseInstalled('codex', codex)[0].name, 'pdf')
  assert.deepEqual(parseInstalled('antigravity', '[]'), [])
  assert.deepEqual(lastJson('Fetching…\n{"ok":true}'), { ok: true })
  assert.deepEqual(pendingCommand(JSON.stringify({ shownCommand: { command: 'curl x | sh', sha256: 'f'.repeat(64) } })), { sha256: 'f'.repeat(64), command: 'curl x | sh' })
  assert.equal(pendingCommand('{"ok":true}'), null)
})

test('pasted MCP JSON fills the form', () => {
  const [first, second] = parseMcpJson(JSON.stringify({ mcpServers: {
    github: { command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'x' } },
    'my docs!': { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer y' } },
  } }))
  assert.deepEqual({ name: first.name, transport: first.transport, args: first.args, env: first.env }, { name: 'github', transport: 'stdio', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'x' } })
  assert.deepEqual({ name: second.name, transport: second.transport, url: second.url }, { name: 'my-docs-', transport: 'http', url: 'https://example.com/mcp' })
  assert.equal(parseMcpJson('{"command":"uvx","args":["mcp-server-time"]}')[0].command, 'uvx')
  assert.equal(typeof parseMcpJson('not json'), 'string')
  assert.equal(typeof parseMcpJson('{"name":{"foo":1}}'), 'string')
})

test('tasks get their agent\'s MCP servers and the private config is removed afterwards', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-office-mcp-'))
  const workspace = join(root, 'project'), data = join(root, 'data'), captures = join(root, 'captures')
  const fakeCli = join(root, 'fake-provider.js')
  await Promise.all([mkdir(workspace), mkdir(captures)])
  // Records the arguments, the Claude config file content and the Codex environment.
  await writeFile(fakeCli, [
    "const { readFileSync, writeFileSync, statSync } = require('node:fs')",
    "const { join } = require('node:path')",
    'const args = process.argv.slice(2)',
    "const provider = args.includes('exec') ? 'codex' : args.some(arg => arg.startsWith('--print=')) ? 'antigravity' : 'claude'",
    "const configs = args.filter((arg, i) => args[i - 1] === '--mcp-config' && !arg.startsWith('{'))",
    "const files = configs.map(file => ({ mode: (statSync(file).mode & 0o777).toString(8), content: JSON.parse(readFileSync(file, 'utf8')) }))",
    "process.stdin.resume(); process.stdin.on('end', () => {",
    "  writeFileSync(join(process.env.AGENT_OFFICE_FAKE_CAPTURE, provider + '.json'), JSON.stringify({ args, files, token: process.env.GITHUB_TOKEN || null, header: process.env.AGENT_OFFICE_MCP_1_H0 || null }))",
    "  process.stdout.write(JSON.stringify(provider === 'codex' ? { type: 'turn.completed' } : provider === 'claude' ? { type: 'result' } : { event: 'result', result: { status: 'SUCCESS' } }) + '\\n')",
    '})',
  ].join('\n'))
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
  const port = listener.address().port; await new Promise(done => listener.close(done))
  const base = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, [resolve('server/index.mjs')], { cwd: resolve('.'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), AGENT_OFFICE_DATA_DIR: data, CODEX_BIN: fakeCli, CLAUDE_BIN: fakeCli, AGY_BIN: fakeCli, AGENT_OFFICE_FAKE_CAPTURE: captures } })
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    const result = await response.json()
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result)}`)
    return result
  }
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(500) })).ok) break } catch { /* start-up */ }
      await sleep(70)
    }
    const agent = (await request('/api/state')).agents[0]
    const created = (await request('/api/mcp', 'POST', stdio)).server
    assert.equal(JSON.stringify(created).includes('secret-1'), false, 'The API never returns secret values')
    await request('/api/mcp', 'POST', { ...http, agents: [agent.id] })
    assert.equal((await request('/api/state')).mcpCount, 2)
    const runTask = async provider => {
      const { task } = await request('/api/tasks', 'POST', { agentId: agent.id, provider, workspace, prompt: 'Check tools' })
      for (let i = 0; i < 100; i++) {
        const latest = (await request('/api/state')).tasks.find(item => item.id === task.id)
        if (latest.status !== 'running') { assert.equal(latest.status, 'completed'); return latest }
        await sleep(40)
      }
      throw new Error(`${provider} did not finish`)
    }
    const claudeTask = await runTask('claude')
    assert.ok(claudeTask.events.some(event => event.message === 'MCP servers attached: github, docs.'))
    const claude = JSON.parse(await readFile(join(captures, 'claude.json'), 'utf8'))
    assert.equal(claude.files.length, 1)
    assert.equal(claude.files[0].mode, '600')
    assert.equal(claude.files[0].content.mcpServers.github.env.GITHUB_TOKEN, 'secret-1')
    assert.equal(claude.args.join(' ').includes('secret'), false)
    assert.ok(claude.args[claude.args.indexOf('--allowedTools') + 1].endsWith(',mcp__github'))
    assert.deepEqual(await readdir(join(data, 'runs')), [], 'The per-run config is deleted after the run')

    await runTask('codex')
    const codex = JSON.parse(await readFile(join(captures, 'codex.json'), 'utf8'))
    assert.equal(codex.token, 'secret-1'); assert.equal(codex.header, 'Bearer secret-2')
    assert.equal(codex.args.join(' ').includes('secret'), false)

    const agyTask = await runTask('antigravity')
    assert.ok(agyTask.events.some(event => /does not accept MCP servers per run/.test(event.message)))

    await request(`/api/mcp/${created.id}`, 'PUT', { enabled: false })
    assert.equal((await request('/api/mcp')).servers.find(server => server.id === created.id).enabled, false)
    assert.equal(JSON.parse(await readFile(join(data, 'mcp.json'), 'utf8')).find(server => server.id === created.id).env.GITHUB_TOKEN, 'secret-1', 'A partial edit keeps saved secrets')
    await request(`/api/mcp/${created.id}`, 'DELETE')
    assert.equal((await request('/api/mcp')).servers.length, 1)
  } finally {
    server.kill('SIGTERM')
    await once(server, 'exit').catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})
