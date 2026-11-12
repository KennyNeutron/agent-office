import { DEFAULT_AGENTS, type OfficeAgent } from '../types'
import { DEPARTMENTS } from '../agents'

// The public preview has no server and never reads a visitor's real projects.
// Every visitor gets a separate roster stored only in their own browser.
const STORAGE_KEY = 'agent-office-public-demo-roster-v1'
const validLabel = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max &&
  !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)

export function validateDemoAgent(value: unknown): value is OfficeAgent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const a = value as Record<string, unknown>
  return typeof a.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(a.id) &&
    validLabel(a.name, 45) && validLabel(a.role, 70) && validLabel(a.specialty, 180) &&
    typeof a.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.color) &&
    typeof a.department === 'string' && DEPARTMENTS.some(department => department.id === a.department) &&
    typeof a.short === 'string' && a.short.length <= 4 &&
    (a.provider == null || a.provider === 'codex' || a.provider === 'claude' || a.provider === 'antigravity') &&
    (a.permissionMode == null || a.permissionMode === 'restricted' || a.permissionMode === 'approve-for-me' || a.permissionMode === 'full-access') &&
    !(a.provider === 'antigravity' && a.permissionMode === 'approve-for-me')
}

export function loadDemoRoster(): OfficeAgent[] {
  try {
    const json = localStorage.getItem(STORAGE_KEY)
    if (json === null) return DEFAULT_AGENTS.map(agent => ({ ...agent }))
    const data: unknown = JSON.parse(json)
    if (Array.isArray(data) && data.length <= 1000 && data.every(validateDemoAgent) &&
      new Set(data.map(agent => agent.id)).size === data.length) return data
  } catch { /* Invalid or disabled local storage: show default demo agents. */ }
  return DEFAULT_AGENTS.map(agent => ({ ...agent }))
}

export function saveDemoRoster(agents: OfficeAgent[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(agents)) } catch { /* Storage disabled/full. */ }
}

export function makeDemoAgent(input: Omit<OfficeAgent, 'id' | 'short'>, id: string = crypto.randomUUID()): OfficeAgent {
  const name = input.name.trim()
  return { id, name, role: input.role.trim(), specialty: input.specialty.trim(),
    department: input.department, color: input.color, short: name.slice(0, 2).toUpperCase(),
    provider: input.provider ?? null, permissionMode: input.permissionMode ?? 'restricted' }
}
