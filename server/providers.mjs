import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'

function usableFile(path, platform) {
  try {
    if (!statSync(path).isFile()) return false
    if (platform !== 'win32' && !/\.[cm]?js$/i.test(path)) accessSync(path, constants.X_OK)
    return true
  } catch { return false }
}

function directEntry(bin, id, platform) {
  if (!usableFile(bin, platform)) return null
  if (!/\.(cmd|bat)$/i.test(bin)) return usableFile(bin, platform) ? bin : null
  const entries = id === 'claude'
    ? [join('@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), join('@anthropic-ai', 'claude-code', 'cli.js')]
    : id === 'codex' ? [join('@openai', 'codex', 'bin', 'codex.js')]
      : [] // agy ships as a native executable, never an npm .cmd shim.
  return entries.map(entry => join(dirname(bin), 'node_modules', entry)).find(path => usableFile(path, platform)) || null
}

export const PROVIDERS = [
  { id: 'codex', name: 'Codex CLI', env: 'CODEX_BIN', command: 'codex' },
  { id: 'claude', name: 'Claude Code', env: 'CLAUDE_BIN', command: 'claude' },
  { id: 'antigravity', name: 'Antigravity CLI', env: 'AGY_BIN', command: 'agy' },
]

export function discoverProviders(env = process.env, platform = process.platform) {
  const folders = (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
  return PROVIDERS.map(provider => {
    const configured = env[provider.env]
    let bin = configured && isAbsolute(configured) ? directEntry(configured, provider.id, platform) : null
    if (!configured) {
      const names = platform === 'win32'
        ? [`${provider.command}.exe`, `${provider.command}.cmd`]
        : [provider.command]
      for (const folder of folders) {
        for (const name of names) {
          const candidate = join(folder, name)
          // A broken shim in an earlier PATH entry must not hide a working CLI.
          bin = directEntry(candidate, provider.id, platform)
          if (bin) break
        }
        if (bin) break
      }
    }
    return { id: provider.id, name: provider.name, available: Boolean(bin), bin }
  })
}

export function supportsPermissionMode(id, mode) {
  return mode === 'restricted' || mode === 'full-access' ||
    (mode === 'approve-for-me' && (id === 'codex' || id === 'claude'))
}

export function launchArgs(id, workspace, permissionMode = 'restricted') {
  if (!supportsPermissionMode(id, permissionMode)) throw new Error('Unsupported permission mode.')
  const fullAccess = permissionMode === 'full-access'
  const autoReview = permissionMode === 'approve-for-me'
  if (id === 'codex') {
    const permissions = fullAccess ? ['--dangerously-bypass-approvals-and-sandbox']
      : autoReview ? ['--approve-for-me'] : ['-s', 'workspace-write']
    return ['exec', '--json', '--skip-git-repo-check', ...permissions, '-C', workspace, '-']
  }
  if (id === 'claude') {
    const permissions = fullAccess ? ['--dangerously-skip-permissions']
      : ['--permission-mode', autoReview ? 'auto' : 'acceptEdits']
    return ['--print', '--verbose', '--output-format', 'stream-json', ...permissions, '--permission-prompts', 'none']
  }
  if (id === 'antigravity') {
    // Restricted: file edits are accepted; commands and other approvals are soft-denied
    // headlessly and reported via the result's denied_actions. Slash commands stay literal text.
    return ['--output-format', 'stream-json', '--disable-slash-commands',
      ...(fullAccess ? ['--dangerously-skip-permissions'] : ['--mode', 'accept-edits'])]
  }
  throw new Error('Unknown AI provider.')
}

export function foldersOverlap(left, right, platform = process.platform) {
  const paths = platform === 'win32' ? win32 : { resolve, relative, isAbsolute, sep }
  const normalize = path => platform === 'win32' ? paths.resolve(path).toLowerCase() : paths.resolve(path)
  const a = normalize(left), b = normalize(right)
  const inside = (parent, child) => {
    const remainder = paths.relative(parent, child)
    return !remainder || (!paths.isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith('..' + paths.sep))
  }
  return inside(a, b) || inside(b, a)
}

export const KNOWLEDGE_TOOLS = ['search_knowledge', 'read_note', 'add_note']
/** Whether Agent Office can hand this CLI its knowledge MCP server for a single run. */
export const supportsKnowledgeMcp = id => id === 'claude' || id === 'codex'

/**
 * Per-run MCP wiring for the team knowledge server (`mcp` = { command, args }).
 * Claude Code and Codex accept MCP servers on the command line, merged with the
 * user's own configuration; Antigravity CLI only reads a global config file.
 */
function knowledgeMcpArgs(id, mcp) {
  if (!mcp || !supportsKnowledgeMcp(id)) return []
  if (id === 'claude') return ['--mcp-config', JSON.stringify({ mcpServers: { 'agent-office': { type: 'stdio', command: mcp.command, args: mcp.args } } }),
    '--allowedTools', KNOWLEDGE_TOOLS.map(tool => `mcp__agent-office__${tool}`).join(',')]
  // TOML accepts JSON string and string-array literals.
  return ['-c', `mcp_servers.agent_office.command=${JSON.stringify(mcp.command)}`, '-c', `mcp_servers.agent_office.args=${JSON.stringify(mcp.args)}`]
}

export function providerCommand(provider, workspace, prompt, permissionMode, mcp = null) {
  const args = launchArgs(provider.id, workspace, permissionMode)
  const extra = knowledgeMcpArgs(provider.id, mcp)
  // Codex options follow the "exec" subcommand; Claude's go before its trailing flags.
  if (extra.length) args.splice(provider.id === 'codex' ? 1 : args.indexOf('--permission-prompts'), 0, ...extra)
  // agy takes the prompt as a flag value; the "=" form keeps a prompt starting with "-" from parsing as a flag.
  if (provider.id === 'antigravity') args.unshift(`--print=${prompt}`)
  const script = /\.[cm]?js$/i.test(provider.bin)
  return { command: script ? process.execPath : provider.bin, args: script ? [provider.bin, ...args] : args,
    input: provider.id === 'antigravity' ? '' : prompt }
}
