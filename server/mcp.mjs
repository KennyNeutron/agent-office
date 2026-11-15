// Office-managed MCP servers.
//
// Servers added in Agent Office are stored in its data folder (mcp.json) and handed
// to Claude Code and Codex for each task or chat of the agents they are assigned to.
// The CLIs' own global configuration is never changed. Antigravity CLI only reads
// its global config, so it does not receive them.
//
// Environment variables and HTTP headers often hold API keys. They are never put on
// a command line (other local users can read process arguments):
//   - Claude Code reads them from a private (0600) per-run config file.
//   - Codex reads them from its own environment, which the office fills per run.
// The API never returns their values to the browser, only their names.

export const MAX_MCP_SERVERS = 30
export const MCP_LIMITS = { name: 40, description: 300, command: 1000, arg: 2000, args: 40, url: 2000, pairs: 30, key: 100, value: 8000 }
/** CLIs that accept MCP servers for a single run. */
export const MCP_RUN_PROVIDERS = ['claude', 'codex']
export const supportsRunMcp = id => MCP_RUN_PROVIDERS.includes(id)

// Names become Claude tool ids (mcp__<name>__tool) and Codex config keys.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_KEY = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
// The team knowledge server already uses these names.
const RESERVED = new Set(['agent-office', 'agent_office'])
const AGENT_ID = /^[A-Za-z0-9_-]{1,80}$/

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' ? value.trim() : ''
const controlChars = value => /[\0\r\n]/.test(value)

function pairsError(pairs, label, keyPattern) {
  if (pairs == null) return null
  if (!object(pairs)) return `Invalid ${label}.`
  const entries = Object.entries(pairs)
  if (entries.length > MCP_LIMITS.pairs) return `Use at most ${MCP_LIMITS.pairs} ${label}.`
  for (const [key, value] of entries) {
    if (!keyPattern.test(key) || key.length > MCP_LIMITS.key) return `"${key.slice(0, 40)}" is not a valid ${label === 'headers' ? 'header name' : 'variable name'}.`
    // null keeps the saved value when editing a server.
    if (value !== null && (typeof value !== 'string' || value.length > MCP_LIMITS.value || /[\0\r\n]/.test(value))) return `The value of ${key} is invalid.`
  }
  return null
}

/** Returns an error message, or null when the input can be saved. */
export function validateMcpInput(input, { servers = [], id = null } = {}) {
  if (!object(input)) return 'Invalid MCP server.'
  const name = text(input.name)
  if (!name) return 'Give the server a name.'
  if (name.length > MCP_LIMITS.name || !NAME.test(name)) return `Use up to ${MCP_LIMITS.name} letters, digits, "-" or "_" for the name, starting with a letter or digit.`
  if (RESERVED.has(name.toLowerCase())) return 'That name is used by the team knowledge server.'
  if (servers.some(server => server.id !== id && server.name.toLowerCase() === name.toLowerCase())) return 'Another server already uses that name.'
  if (input.description != null && (typeof input.description !== 'string' || input.description.length > MCP_LIMITS.description)) return 'Keep the description short.'
  if (input.transport !== 'stdio' && input.transport !== 'http') return 'Choose a command (stdio) or URL (HTTP) server.'
  if (input.transport === 'stdio') {
    const command = text(input.command)
    if (!command) return 'Enter the command that starts the server.'
    if (command.length > MCP_LIMITS.command || controlChars(command)) return 'The command is invalid.'
    if (input.args != null && (!Array.isArray(input.args) || input.args.length > MCP_LIMITS.args ||
      input.args.some(arg => typeof arg !== 'string' || arg.length > MCP_LIMITS.arg || /[\0\r\n]/.test(arg)))) return `Use at most ${MCP_LIMITS.args} arguments, one per line.`
    const error = pairsError(input.env, 'environment variables', ENV_KEY)
    if (error) return error
  } else {
    const url = text(input.url)
    let parsed
    try { parsed = new URL(url) } catch { return 'Enter the server URL, e.g. https://example.com/mcp.' }
    if (url.length > MCP_LIMITS.url || !['http:', 'https:'].includes(parsed.protocol)) return 'The URL must start with http:// or https://.'
    const error = pairsError(input.headers, 'headers', HEADER_KEY)
    if (error) return error
  }
  if (input.agents !== 'all' && !(Array.isArray(input.agents) && input.agents.length <= 500 && input.agents.every(agent => typeof agent === 'string' && AGENT_ID.test(agent))))
    return 'Choose which agents can use the server.'
  if (input.enabled != null && typeof input.enabled !== 'boolean') return 'Invalid enabled setting.'
  if (input.autoApprove != null && typeof input.autoApprove !== 'boolean') return 'Invalid approval setting.'
  return null
}

/** Merges submitted pairs with saved ones: null keeps a saved value, missing keys are removed. */
function mergePairs(next, previous = {}) {
  const merged = {}
  for (const [key, value] of Object.entries(next || {})) {
    if (value === null) { if (typeof previous[key] === 'string') merged[key] = previous[key] }
    else merged[key] = value
  }
  return merged
}

export function makeMcpServer(input, { id, previous = null, now = new Date() }) {
  const stamp = now.toISOString()
  const stdio = input.transport === 'stdio'
  return {
    id,
    name: text(input.name),
    description: text(input.description ?? ''),
    transport: input.transport,
    command: stdio ? text(input.command) : '',
    args: stdio ? (input.args || []).filter(arg => arg !== '') : [],
    env: stdio ? mergePairs(input.env, previous?.env) : {},
    url: stdio ? '' : text(input.url),
    headers: stdio ? {} : mergePairs(input.headers, previous?.headers),
    agents: input.agents === 'all' ? 'all' : [...new Set(input.agents)],
    enabled: input.enabled ?? previous?.enabled ?? true,
    autoApprove: input.autoApprove ?? previous?.autoApprove ?? true,
    createdAt: previous?.createdAt ?? stamp,
    updatedAt: stamp,
  }
}

export function validStoredMcp(value) {
  return Array.isArray(value) && value.length <= MAX_MCP_SERVERS && value.every(server => object(server) &&
    typeof server.id === 'string' && !validateMcpInput(server, { servers: value, id: server.id }) &&
    object(server.env ?? {}) && object(server.headers ?? {}) &&
    Object.values({ ...server.env, ...server.headers }).every(item => typeof item === 'string'))
}

/** What the browser sees: everything except secret values. */
export function publicMcpServer(server) {
  const { env, headers, ...rest } = server
  return { ...rest, envKeys: Object.keys(env || {}), headerKeys: Object.keys(headers || {}) }
}

/** Enabled servers that apply to this agent. */
export function mcpForAgent(servers, agentId) {
  return servers.filter(server => server.enabled && (server.agents === 'all' || server.agents.includes(agentId)))
}

/** Claude Code `--mcp-config` content for these servers. */
export function claudeMcpConfig(servers) {
  return { mcpServers: Object.fromEntries(servers.map(server => [server.name, server.transport === 'stdio'
    ? { type: 'stdio', command: server.command, args: server.args, env: server.env }
    : { type: 'http', url: server.url, headers: server.headers }])) }
}

/** Claude Code permission rules that allow every tool of the auto-approved servers. */
export const claudeAllowedTools = servers => servers.filter(server => server.autoApprove).map(server => `mcp__${server.name}`)

/**
 * Codex `-c` overrides plus the environment the Codex process needs. Secrets travel
 * only in `env`: stdio variables are forwarded by name (`env_vars`), and HTTP
 * headers are read from generated variables (`env_http_headers`).
 */
export function codexMcpOverrides(servers) {
  const args = [], env = {}, skipped = []
  servers.forEach((server, index) => {
    const key = `mcp_servers.${server.name}`
    const set = (path, value) => args.push('-c', `${key}.${path}=${JSON.stringify(value)}`)
    if (server.transport === 'stdio') {
      const names = Object.keys(server.env)
      // Two servers cannot receive different values under the same variable name.
      if (names.some(name => name in env && env[name] !== server.env[name])) { skipped.push(server.name); return }
      Object.assign(env, server.env)
      set('command', server.command)
      set('args', server.args)
      if (names.length) set('env_vars', names)
    } else {
      set('url', server.url)
      const headers = {}
      Object.entries(server.headers).forEach(([header, value], position) => {
        const variable = `AGENT_OFFICE_MCP_${index}_H${position}`
        env[variable] = value
        headers[header] = variable
      })
      // TOML inline table: {"Header" = "VARIABLE"}
      if (Object.keys(headers).length) args.push('-c', `${key}.env_http_headers={${Object.entries(headers).map(([h, v]) => `${JSON.stringify(h)}=${JSON.stringify(v)}`).join(',')}}`)
    }
    if (server.autoApprove) set('default_tools_approval_mode', 'approve')
  })
  return { args, env, skipped }
}
