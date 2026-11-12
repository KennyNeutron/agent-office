import { randomUUID } from 'node:crypto'

export const AGENT_PROVIDERS = ['codex', 'claude', 'antigravity']
export const AGENT_PERMISSIONS = ['restricted', 'approve-for-me', 'full-access']
export const DEPARTMENTS = ['architecture', 'engineering', 'design', 'quality', 'research', 'operations', 'security', 'data', 'general']
export const DEFAULT_AGENTS = [
  { id: 'atlas', name: 'Atlas', role: 'Tech Lead', specialty: 'Architecture & planning', color: '#8b82ff', short: 'AT', department: 'architecture' },
  { id: 'nova', name: 'Nova', role: 'Developer', specialty: 'Code & implementation', color: '#4cd7e6', short: 'NV', department: 'engineering' },
  { id: 'pixel', name: 'Pixel', role: 'Creative', specialty: 'Design & experience', color: '#ffbb72', short: 'PX', department: 'design' },
  { id: 'sentinel', name: 'Sentinel', role: 'QA Engineer', specialty: 'Tests & reliability', color: '#78e4aa', short: 'SN', department: 'quality' },
]

// eslint-disable-next-line no-control-regex -- Reject terminal control characters in user-editable agent labels.
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(value)
export function validateAgent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Invalid agent.'
  if (!validText(input.name, 45)) return 'Agent name must be 1–45 characters.'
  if (!validText(input.role, 70)) return 'Agent role must be 1–70 characters.'
  if (!validText(input.specialty, 180)) return 'Agent specialty must be 1–180 characters.'
  if (!DEPARTMENTS.includes(input.department)) return 'Unknown department.'
  if (typeof input.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.color)) return 'Invalid agent color.'
  // Optional launch defaults: used for this agent's tasks and schedules that follow the agent.
  if (input.provider != null && !AGENT_PROVIDERS.includes(input.provider)) return 'Unknown AI provider.'
  if (input.permissionMode != null && !AGENT_PERMISSIONS.includes(input.permissionMode)) return 'Unknown permission mode.'
  if (input.provider === 'antigravity' && input.permissionMode === 'approve-for-me') return 'This permission mode is unavailable for the selected provider.'
  return null
}

export function makeAgent(input, id = randomUUID()) {
  const name = input.name.trim()
  return { id, name, role: input.role.trim(), specialty: input.specialty.trim(),
    color: input.color, department: input.department, short: name.slice(0, 2).toUpperCase(),
    provider: input.provider ?? null, permissionMode: input.permissionMode ?? 'restricted' }
}

export function validStoredAgents(value) {
  return Array.isArray(value) && value.every(agent => !validateAgent(agent) &&
    typeof agent.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(agent.id)) &&
    new Set(value.map(agent => agent.id)).size === value.length
}
