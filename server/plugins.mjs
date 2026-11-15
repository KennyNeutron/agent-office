// Global plugin manager: lists, installs and removes plugins with each CLI's own
// plugin commands (`claude plugin`, `codex plugin`, `agy plugin`). These change the
// CLI's user configuration, so they also apply when the CLI is used outside the
// office. Every command runs without a shell, and user input is never allowed to
// start with "-", so it cannot be read as an option.
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

export const PLUGIN_PROVIDERS = ['claude', 'codex', 'antigravity']

/** What each CLI's plugin commands can do. */
export const PLUGIN_FEATURES = {
  claude: { catalog: true, toggle: true, marketplaces: true, installHint: 'plugin@marketplace' },
  codex: { catalog: true, toggle: false, marketplaces: true, installHint: 'plugin@marketplace' },
  antigravity: { catalog: false, toggle: true, marketplaces: false, installHint: 'plugin@marketplace or a plugin folder path' },
}

const TARGET = /^[^\s\0-][^\0\r\n]{0,499}$/
const SCOPE = /^(user|project|local)$/
/** A plugin id, marketplace source or folder path a user typed. */
export function validTarget(value) {
  return typeof value === 'string' && TARGET.test(value.trim()) && !/^-/.test(value.trim())
}

/** Argument lists for each operation. */
export function pluginArgs(provider, operation, target = '', options = {}) {
  const t = typeof target === 'string' ? target.trim() : ''
  if (provider === 'claude') {
    const scope = SCOPE.test(options.scope || '') ? ['-s', options.scope] : []
    switch (operation) {
      case 'list': return ['plugin', 'list', '--json']
      case 'catalog': return ['plugin', 'list', '--json', '--available']
      case 'install': return ['plugin', 'install', t, '--json', '-s', 'user',
        ...(/^[0-9a-f]{64}$/i.test(options.acceptCommand || '') ? ['--accept-command', options.acceptCommand] : [])]
      case 'uninstall': return ['plugin', 'uninstall', t, '--json', ...scope]
      case 'enable': return ['plugin', 'enable', t, '--json', ...scope]
      case 'disable': return ['plugin', 'disable', t, '--json', ...scope]
      case 'marketplaces': return ['plugin', 'marketplace', 'list', '--json']
      case 'add-marketplace': return ['plugin', 'marketplace', 'add', t, '--json']
      case 'remove-marketplace': return ['plugin', 'marketplace', 'remove', t, '--json']
    }
  }
  if (provider === 'codex') {
    switch (operation) {
      case 'list': return ['plugin', 'list', '--json']
      case 'catalog': return ['plugin', 'list', '--json', '--available']
      case 'install': return ['plugin', 'add', t, '--json']
      case 'uninstall': return ['plugin', 'remove', t, '--json']
      case 'marketplaces': return ['plugin', 'marketplace', 'list', '--json']
      case 'add-marketplace': return ['plugin', 'marketplace', 'add', t]
      case 'remove-marketplace': return ['plugin', 'marketplace', 'remove', t]
    }
  }
  if (provider === 'antigravity') {
    switch (operation) {
      case 'list': return ['plugin', 'list', '--json']
      case 'install': return ['plugin', 'install', t]
      case 'uninstall': return ['plugin', 'uninstall', t]
      case 'enable': return ['plugin', 'enable', t]
      case 'disable': return ['plugin', 'disable', t]
    }
  }
  return null
}

/** The last JSON value printed (some commands print progress lines first). */
export function lastJson(output) {
  const trimmed = output.trim()
  try { return JSON.parse(trimmed) } catch { /* Fall back to the last JSON line. */ }
  for (const line of trimmed.split('\n').reverse()) {
    const candidate = line.trim()
    if (!/^[[{]/.test(candidate)) continue
    try { return JSON.parse(candidate) } catch { /* Keep looking. */ }
  }
  return null
}

const str = value => typeof value === 'string' ? value : ''
const marketplaceOf = id => id.includes('@') ? id.slice(id.lastIndexOf('@') + 1) : ''

/** Installed plugins as { id, name, marketplace, version, enabled, scope }. */
export function parseInstalled(provider, output) {
  const data = lastJson(output)
  const list = Array.isArray(data) ? data : Array.isArray(data?.installed) ? data.installed : Array.isArray(data?.plugins) ? data.plugins : []
  return list.filter(item => item && typeof item === 'object' && item.installed !== false).map(item => {
    const id = str(item.pluginId) || str(item.id) || str(item.name)
    return {
      id,
      name: str(item.name) || id.split('@')[0],
      marketplace: str(item.marketplaceName) || str(item.marketplace) || marketplaceOf(id),
      version: str(item.version),
      enabled: item.enabled !== false,
      scope: str(item.scope),
      description: str(item.description),
    }
  }).filter(item => item.id)
}

/** Marketplace catalog entries as { id, name, marketplace, description, version, installs, installed }. */
export function parseCatalog(provider, output) {
  const data = lastJson(output)
  const installed = new Set(parseInstalled(provider, output).map(item => item.id))
  const list = Array.isArray(data?.available) ? data.available : []
  return list.filter(item => item && typeof item === 'object').map(item => {
    const id = str(item.pluginId) || str(item.id) || str(item.name)
    return {
      id,
      name: str(item.name) || id.split('@')[0],
      marketplace: str(item.marketplaceName) || marketplaceOf(id),
      description: str(item.description),
      version: str(item.version),
      installs: Number.isFinite(item.installCount) ? item.installCount : null,
      installed: installed.has(id) || item.installed === true,
    }
  }).filter(item => item.id)
}

/** Searches a catalog; the most installed plugins come first. */
export function searchCatalog(catalog, query = '', limit = 60) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  const matches = catalog.filter(item => {
    const haystack = `${item.id} ${item.name} ${item.description}`.toLowerCase()
    return words.every(word => haystack.includes(word))
  })
  matches.sort((a, b) => (b.installs ?? -1) - (a.installs ?? -1) || a.name.localeCompare(b.name))
  return { plugins: matches.slice(0, limit), total: matches.length }
}

export function parseMarketplaces(output) {
  const data = lastJson(output)
  const list = Array.isArray(data) ? data : Array.isArray(data?.marketplaces) ? data.marketplaces : []
  return list.filter(item => item && typeof item === 'object').map(item => ({
    name: str(item.name),
    source: str(item.repo) || str(item.url) || str(item.source?.source ?? item.source) || str(item.path) || str(item.installLocation) || str(item.root),
  })).filter(item => item.name)
}

/**
 * A marketplace may install a plugin by running a command. Claude Code then refuses
 * and reports the command (with its sha256) so a person can review it first.
 */
export function pendingCommand(output) {
  const data = lastJson(output)
  const shown = data?.shownCommand
  if (!shown || typeof shown !== 'object' || !/^[0-9a-f]{64}$/i.test(str(shown.sha256))) return null
  return { sha256: shown.sha256, command: str(shown.command) || str(shown.display) || JSON.stringify(shown.command ?? shown) }
}

/** A readable error from a failed command. */
export function commandError(output, stderr, fallback) {
  const data = lastJson(output)
  const message = str(data?.error) || str(data?.message) || str(data?.error?.message) ||
    stderr.trim().split('\n').filter(Boolean).at(-1) || output.trim().split('\n').filter(Boolean).at(-1) || fallback
  return message.slice(0, 600)
}

const TIMEOUTS = { list: 60_000, catalog: 120_000, marketplaces: 60_000 }
const MAX_OUTPUT = 32 * 1024 * 1024

/** Runs one plugin command for a detected provider ({ id, bin }). */
export function runPluginCommand(provider, operation, target, options = {}) {
  const args = pluginArgs(provider.id, operation, target, options)
  if (!args) return Promise.resolve({ ok: false, code: null, stdout: '', stderr: 'Not supported by this CLI.' })
  const script = /\.[cm]?js$/i.test(provider.bin)
  const command = script ? process.execPath : provider.bin
  const argv = script ? [provider.bin, ...args] : args
  const timeout = TIMEOUTS[operation] ?? 5 * 60_000
  return new Promise(resolve => {
    let stdout = '', stderr = '', settled = false
    let child
    try {
      child = spawn(command, argv, { cwd: options.cwd || homedir(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', CI: '1' } })
    } catch (error) { resolve({ ok: false, code: null, stdout: '', stderr: error.message }); return }
    const done = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result) } }
    const timer = setTimeout(() => { child.kill(); done({ ok: false, code: null, stdout, stderr: `${operation} timed out.` }) }, timeout)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { if (stdout.length < MAX_OUTPUT) stdout += chunk })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000) })
    child.on('error', error => done({ ok: false, code: null, stdout, stderr: error.message }))
    child.on('close', code => done({ ok: code === 0, code, stdout, stderr }))
  })
}
