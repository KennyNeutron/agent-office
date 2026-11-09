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
    : id === 'gemini' ? [join('@google', 'gemini-cli', 'dist', 'index.js')]
      : [join('@openai', 'codex', 'bin', 'codex.js')]
  return entries.map(entry => join(dirname(bin), 'node_modules', entry)).find(path => usableFile(path, platform)) || null
}

export const PROVIDERS = [
  { id: 'codex', name: 'Codex CLI', env: 'CODEX_BIN' },
  { id: 'claude', name: 'Claude Code', env: 'CLAUDE_BIN' },
  { id: 'gemini', name: 'Gemini CLI', env: 'GEMINI_BIN' },
]

export function discoverProviders(env = process.env, platform = process.platform) {
  const folders = (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
  return PROVIDERS.map(provider => {
    const configured = env[provider.env]
    let bin = configured && isAbsolute(configured) ? directEntry(configured, provider.id, platform) : null
    if (!configured) {
      const names = platform === 'win32'
        ? [`${provider.id}.exe`, `${provider.id}.cmd`]
        : [provider.id]
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
  if (id === 'gemini') {
    return ['-p', '--output-format', 'stream-json', '--approval-mode', fullAccess ? 'yolo' : 'auto_edit',
      ...(fullAccess ? ['--sandbox=false'] : [])]
  }
  throw new Error('Motor de IA desconhecido.')
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

export function providerCommand(provider, workspace, prompt, permissionMode) {
  const args = launchArgs(provider.id, workspace, permissionMode)
  if (provider.id === 'gemini') args.splice(1, 0, prompt)
  const script = /\.[cm]?js$/i.test(provider.bin)
  return { command: script ? process.execPath : provider.bin, args: script ? [provider.bin, ...args] : args,
    input: provider.id === 'gemini' ? '' : prompt }
}
