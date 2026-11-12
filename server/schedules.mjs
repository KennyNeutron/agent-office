// Scheduled tasks: validation and next-run calculation shared by the local API
// and the browser demo. Pure functions only — no Node or DOM APIs.
//
// Daily/weekly times use the local timezone of whichever process evaluates
// them (the API's machine for Live mode, the browser for Demo mode).

export const SCHEDULE_REPEATS = ['once', 'interval', 'daily', 'weekly']
export const SCHEDULE_PROVIDERS = ['codex', 'claude', 'antigravity']
export const SCHEDULE_PERMISSIONS = ['restricted', 'approve-for-me', 'full-access']
export const MAX_SCHEDULES = 200
export const MIN_INTERVAL_MINUTES = 5
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60
const MINUTE = 60_000

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
// eslint-disable-next-line no-control-regex -- Labels must not contain terminal control characters.
const controlChars = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

/** Returns an error message, or null when the editable schedule fields are valid. */
export function validateSchedule(input) {
  if (!object(input)) return 'Invalid schedule.'
  if (input.title != null && (typeof input.title !== 'string' || input.title.trim().length > 80 || controlChars.test(input.title))) return 'Schedule name must be at most 80 characters.'
  if (typeof input.agentId !== 'string' || !input.agentId || input.agentId.length > 80) return 'Choose an agent.'
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 10000) return 'Task is empty or too long.'
  if (typeof input.workspace !== 'string' || input.workspace.length > 1000 || input.workspace.includes('\0')) return 'Invalid project directory.'
  if (!SCHEDULE_PROVIDERS.includes(input.provider)) return 'Unknown AI provider.'
  if (!SCHEDULE_PERMISSIONS.includes(input.permissionMode) || (input.provider === 'antigravity' && input.permissionMode === 'approve-for-me')) return 'This permission mode is unavailable for the selected provider.'
  if (!SCHEDULE_REPEATS.includes(input.repeat)) return 'Unknown repeat option.'
  if (typeof input.enabled !== 'boolean') return 'Invalid enabled flag.'
  if (input.useAgentDefaults != null && typeof input.useAgentDefaults !== 'boolean') return 'Invalid agent defaults flag.'
  if ((input.repeat === 'once' || input.repeat === 'interval') && !validDate(input.runAt)) return 'Choose a valid start date and time.'
  if (input.repeat === 'interval' && (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < MIN_INTERVAL_MINUTES || input.intervalMinutes > MAX_INTERVAL_MINUTES)) {
    return `Repeat interval must be between ${MIN_INTERVAL_MINUTES} minutes and 7 days.`
  }
  if ((input.repeat === 'daily' || input.repeat === 'weekly') && !validTime(input.time)) return 'Choose a valid time of day.'
  if (input.repeat === 'weekly' && (!Array.isArray(input.days) || !input.days.length || input.days.length > 7 ||
    !input.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) || new Set(input.days).size !== input.days.length)) return 'Choose at least one weekday.'
  return null
}

function atTime(base, time) {
  const [hours, minutes] = time.split(':').map(Number)
  const date = new Date(base)
  date.setHours(hours, minutes, 0, 0)
  return date
}

/** The first run strictly after `after`, or null when the schedule has no more runs. */
export function computeNextRun(schedule, after = new Date()) {
  const now = after.getTime()
  if (schedule.repeat === 'once') return schedule.lastRunAt ? null : new Date(Date.parse(schedule.runAt)).toISOString()
  if (schedule.repeat === 'interval') {
    const start = Date.parse(schedule.runAt), step = schedule.intervalMinutes * MINUTE
    if (start > now) return new Date(start).toISOString()
    return new Date(start + (Math.floor((now - start) / step) + 1) * step).toISOString()
  }
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now)
    day.setDate(day.getDate() + offset)
    const candidate = atTime(day, schedule.time)
    if (candidate.getTime() <= now) continue
    if (schedule.repeat === 'daily' || schedule.days.includes(candidate.getDay())) return candidate.toISOString()
  }
  return null
}

/** Normalizes editable fields and (re)computes the next run. Run history is kept from `previous`. */
export function makeSchedule(input, id, now = new Date(), previous = null) {
  const schedule = {
    id,
    title: typeof input.title === 'string' ? input.title.trim() : '',
    agentId: input.agentId,
    prompt: input.prompt.trim(),
    workspace: input.workspace,
    provider: input.provider,
    permissionMode: input.permissionMode,
    // When set, each run uses the agent's current default provider and permissions.
    useAgentDefaults: input.useAgentDefaults === true,
    repeat: input.repeat,
    runAt: input.repeat === 'once' || input.repeat === 'interval' ? new Date(Date.parse(input.runAt)).toISOString() : null,
    intervalMinutes: input.repeat === 'interval' ? input.intervalMinutes : null,
    time: input.repeat === 'daily' || input.repeat === 'weekly' ? input.time : null,
    days: input.repeat === 'weekly' ? [...input.days].sort((a, b) => a - b) : null,
    enabled: input.enabled,
    createdAt: previous?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    // Editing a one-time schedule re-arms it.
    lastRunAt: input.repeat === 'once' ? null : previous?.lastRunAt ?? null,
    lastTaskId: previous?.lastTaskId ?? null,
    lastStatus: previous?.lastStatus ?? null,
    lastMessage: previous?.lastMessage ?? '',
    nextRunAt: null,
  }
  schedule.nextRunAt = schedule.enabled ? computeNextRun(schedule, now) : null
  return schedule
}

/** A once-only schedule must not be armed for a time that has already passed. */
export function staleOnceSchedule(input, now = new Date()) {
  return input.repeat === 'once' && input.enabled && Date.parse(input.runAt) < now.getTime() - MINUTE
}

export function isDue(schedule, now = new Date()) {
  return schedule.enabled && Boolean(schedule.nextRunAt) && Date.parse(schedule.nextRunAt) <= now.getTime()
}

/** Records a launch attempt. Waiting attempts keep the slot so the run happens once the agent is free. */
export function recordRun(schedule, outcome, now = new Date()) {
  const next = { ...schedule, updatedAt: now.toISOString(), lastStatus: outcome.status, lastMessage: outcome.message || '' }
  if (outcome.status === 'waiting') return next
  next.lastRunAt = now.toISOString()
  if (outcome.taskId) next.lastTaskId = outcome.taskId
  if (schedule.repeat === 'once') { next.enabled = false; next.nextRunAt = null }
  else next.nextRunAt = computeNextRun(next, now)
  return next
}

/** Gemini CLI was replaced by Antigravity CLI; saved Gemini schedules move over unchanged otherwise. */
export function migrateSchedules(value) {
  return Array.isArray(value) ? value.map(item => item && typeof item === 'object' && item.provider === 'gemini' ? { ...item, provider: 'antigravity' } : item) : value
}

export function validStoredSchedules(value) {
  return Array.isArray(value) && value.length <= MAX_SCHEDULES && value.every(item => !validateSchedule(item) &&
    typeof item.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.id) &&
    (item.nextRunAt === null || validDate(item.nextRunAt)) && (item.lastRunAt === null || validDate(item.lastRunAt)) &&
    (item.lastTaskId === null || typeof item.lastTaskId === 'string') &&
    (item.lastStatus === null || ['launched', 'waiting', 'failed'].includes(item.lastStatus)) &&
    typeof item.lastMessage === 'string' && validDate(item.createdAt) && validDate(item.updatedAt)) &&
    new Set(value.map(item => item.id)).size === value.length
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** A short English description such as "Every Mon, Wed at 09:00". */
export function describeRepeat(schedule) {
  if (schedule.repeat === 'once') return 'Once'
  if (schedule.repeat === 'interval') {
    const minutes = schedule.intervalMinutes
    return minutes % 1440 === 0 ? `Every ${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
      : minutes % 60 === 0 ? `Every ${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `Every ${minutes} min`
  }
  if (schedule.repeat === 'daily') return `Every day at ${schedule.time}`
  const days = schedule.days.length === 7 ? 'day' : schedule.days.join() === '1,2,3,4,5' ? 'weekday' : schedule.days.map(day => WEEKDAYS[day]).join(', ')
  return `Every ${days} at ${schedule.time}`
}
