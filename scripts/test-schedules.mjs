import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { computeNextRun, describeRepeat, isDue, makeSchedule, recordRun, staleOnceSchedule, validStoredSchedules, validateSchedule } from '../server/schedules.mjs'

const sleep = ms => new Promise(done => setTimeout(done, ms))
const base = { agentId: 'nova', prompt: 'Run the test suite', workspace: '/tmp/project', provider: 'codex', permissionMode: 'restricted', enabled: true,
  runAt: null, intervalMinutes: null, time: null, days: null }
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

test('schedule validation covers every repeat type and provider permission rules', () => {
  assert.equal(validateSchedule({ ...base, repeat: 'once', runAt: local(2030, 1, 1, 9).toISOString() }), null)
  assert.equal(validateSchedule({ ...base, repeat: 'interval', runAt: new Date().toISOString(), intervalMinutes: 30 }), null)
  assert.equal(validateSchedule({ ...base, repeat: 'daily', time: '09:30' }), null)
  assert.equal(validateSchedule({ ...base, repeat: 'weekly', time: '23:59', days: [1, 3] }), null)
  assert.match(validateSchedule({ ...base, repeat: 'once', runAt: 'tomorrow' }), /start date/)
  assert.match(validateSchedule({ ...base, repeat: 'interval', runAt: new Date().toISOString(), intervalMinutes: 1 }), /interval/)
  assert.match(validateSchedule({ ...base, repeat: 'daily', time: '24:00' }), /time of day/)
  assert.match(validateSchedule({ ...base, repeat: 'weekly', time: '09:00', days: [] }), /weekday/)
  assert.match(validateSchedule({ ...base, repeat: 'weekly', time: '09:00', days: [1, 1] }), /weekday/)
  assert.match(validateSchedule({ ...base, repeat: 'daily', time: '09:00', provider: 'antigravity', permissionMode: 'approve-for-me' }), /permission/)
  assert.match(validateSchedule({ ...base, repeat: 'daily', time: '09:00', prompt: '  ' }), /empty/)
  assert.match(validateSchedule({ ...base, repeat: 'hourly' }), /repeat/)
  assert.equal(validateSchedule({ ...base, repeat: 'daily', time: '09:00', useAgentDefaults: true }), null)
  assert.match(validateSchedule({ ...base, repeat: 'daily', time: '09:00', useAgentDefaults: 'yes' }), /agent defaults/)
  assert.equal(makeSchedule({ ...base, repeat: 'daily', time: '09:00' }, 'legacy').useAgentDefaults, false)
  assert.equal(staleOnceSchedule({ ...base, repeat: 'once', runAt: new Date(Date.now() - 5 * 60_000).toISOString() }), true)
  assert.equal(staleOnceSchedule({ ...base, repeat: 'once', enabled: false, runAt: new Date(0).toISOString() }), false)
})

test('next run is computed for once, interval, daily and weekly schedules', () => {
  const now = local(2030, 1, 2, 10, 0) // Wednesday
  assert.equal(computeNextRun({ ...base, repeat: 'once', runAt: local(2030, 1, 2, 9).toISOString(), lastRunAt: null }, now), local(2030, 1, 2, 9).toISOString(), 'a missed one-time run is still due')
  assert.equal(computeNextRun({ ...base, repeat: 'once', runAt: local(2030, 1, 2, 9).toISOString(), lastRunAt: now.toISOString() }, now), null)
  const interval = { ...base, repeat: 'interval', runAt: local(2030, 1, 2, 8, 0).toISOString(), intervalMinutes: 45, lastRunAt: null }
  assert.equal(computeNextRun(interval, now), local(2030, 1, 2, 10, 15).toISOString())
  assert.equal(computeNextRun({ ...interval, runAt: local(2030, 1, 3).toISOString() }, now), local(2030, 1, 3).toISOString())
  assert.equal(computeNextRun({ ...base, repeat: 'daily', time: '10:00', lastRunAt: null }, now), local(2030, 1, 3, 10).toISOString(), 'strictly after now')
  assert.equal(computeNextRun({ ...base, repeat: 'daily', time: '18:30', lastRunAt: null }, now), local(2030, 1, 2, 18, 30).toISOString())
  assert.equal(computeNextRun({ ...base, repeat: 'weekly', time: '09:00', days: [1], lastRunAt: null }, now), local(2030, 1, 7, 9).toISOString(), 'next Monday')
  assert.equal(computeNextRun({ ...base, repeat: 'weekly', time: '09:00', days: [3], lastRunAt: null }, now), local(2030, 1, 9, 9).toISOString(), 'same weekday, next week')
  assert.equal(describeRepeat({ repeat: 'weekly', time: '09:00', days: [1, 2, 3, 4, 5] }), 'Every weekday at 09:00')
  assert.equal(describeRepeat({ repeat: 'interval', intervalMinutes: 120 }), 'Every 2 hours')
})

test('recording runs consumes once schedules, keeps waiting slots and advances recurring ones', () => {
  const now = local(2030, 1, 2, 10, 0)
  const once = makeSchedule({ ...base, repeat: 'once', runAt: local(2030, 1, 2, 9).toISOString() }, 's1', local(2030, 1, 1))
  assert.equal(isDue(once, now), true)
  const waiting = recordRun(once, { status: 'waiting', message: 'Agent is already working.' }, now)
  assert.equal(waiting.nextRunAt, once.nextRunAt)
  assert.equal(isDue(waiting, now), true, 'a waiting schedule keeps retrying')
  const done = recordRun(waiting, { status: 'launched', taskId: 't1' }, now)
  assert.deepEqual([done.enabled, done.nextRunAt, done.lastTaskId], [false, null, 't1'])
  const daily = recordRun(makeSchedule({ ...base, repeat: 'daily', time: '09:00' }, 's2', local(2030, 1, 1)), { status: 'failed', message: 'CLI missing' }, now)
  assert.equal(daily.nextRunAt, local(2030, 1, 3, 9).toISOString())
  assert.equal(daily.lastStatus, 'failed')
  assert.equal(validStoredSchedules([done, daily]), true)
  assert.equal(validStoredSchedules([done, done]), false)
  assert.equal(makeSchedule({ ...base, repeat: 'daily', time: '09:00', enabled: false }, 's3').nextRunAt, null)
})

test('the API launches due schedules, waits for busy agents and removes schedules with their agent', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-office-schedules-'))
  const workspace = join(root, 'project'), data = join(root, 'data'), fakeCli = join(root, 'fake-provider.js')
  await mkdir(workspace)
  // Each run stays busy briefly so a second due schedule for the same agent must wait.
  await writeFile(fakeCli, [
    "process.stdin.resume()",
    "process.stdin.on('end', () => setTimeout(() => process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n'), 700))",
  ].join('\n'))
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise(done => listener.close(done))
  const api = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, [resolve('server/index.mjs')], {
    cwd: resolve('.'), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), AGENT_OFFICE_DATA_DIR: data, CODEX_BIN: fakeCli, AGENT_OFFICE_SCHEDULER_MS: '250' },
  })
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(api + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  const waitFor = async (check, label) => {
    for (let i = 0; i < 120; i++) { const state = (await call('/api/state')).body; if (check(state)) return state; await sleep(100) }
    throw new Error('Timed out waiting for ' + label)
  }
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${api}/api/state`, { signal: AbortSignal.timeout(500) })).ok) break } catch { /* start-up */ }
      await sleep(70)
    }
    const input = { ...base, workspace, repeat: 'once', runAt: new Date(Date.now() + 400).toISOString(), title: 'Nightly check' }
    assert.equal((await call('/api/schedules', 'POST', { ...input, agentId: 'missing' })).status, 400)
    assert.equal((await call('/api/schedules', 'POST', { ...input, workspace: 'relative/path' })).status, 400)
    assert.equal((await call('/api/schedules', 'POST', { ...input, runAt: new Date(Date.now() - 600_000).toISOString() })).status, 400)
    const first = await call('/api/schedules', 'POST', input)
    assert.equal(first.status, 201, JSON.stringify(first.body))
    const second = await call('/api/schedules', 'POST', { ...input, title: 'Second', prompt: 'Second run' })
    assert.equal(second.status, 201)

    const launched = await waitFor(state => state.tasks.some(task => task.scheduleId === first.body.schedule.id || task.scheduleId === second.body.schedule.id), 'first scheduled task')
    const waiting = await waitFor(state => state.schedules.some(item => item.lastStatus === 'waiting'), 'busy agent to hold the second schedule')
    assert.match(waiting.schedules.find(item => item.lastStatus === 'waiting').lastMessage, /already working/)
    assert.ok(launched.tasks[0].events.some(event => /Started by schedule/.test(event.message)))
    const finished = await waitFor(state => state.schedules.every(item => item.lastStatus === 'launched' && !item.enabled) &&
      state.tasks.filter(task => task.scheduleId).length === 2 && state.tasks.every(task => task.status === 'completed'), 'both schedules to run')
    assert.ok(finished.schedules.every(item => item.nextRunAt === null && item.lastTaskId))

    const daily = await call('/api/schedules', 'POST', { ...input, repeat: 'daily', time: '03:00', runAt: null })
    assert.equal(daily.status, 201)
    assert.ok(Date.parse(daily.body.schedule.nextRunAt) > Date.now())
    const manual = await call(`/api/schedules/${daily.body.schedule.id}/run`, 'POST', {})
    assert.equal(manual.status, 201, JSON.stringify(manual.body))
    assert.equal(manual.body.task.scheduleId, daily.body.schedule.id)
    const paused = await call(`/api/schedules/${daily.body.schedule.id}`, 'PUT', { ...input, repeat: 'daily', time: '03:00', runAt: null, enabled: false })
    assert.deepEqual([paused.status, paused.body.schedule.nextRunAt, paused.body.schedule.lastTaskId], [200, null, manual.body.task.id])
    const stored = JSON.parse(await readFile(join(data, 'schedules.json'), 'utf8'))
    assert.equal(stored.length, 3)

    await waitFor(state => state.tasks.every(task => task.status !== 'running'), 'manual run to finish')
    assert.equal((await call('/api/agents/nova', 'DELETE')).status, 200)
    const after = await waitFor(state => state.schedules.length === 0, 'schedules of the removed agent to be deleted')
    assert.equal(after.schedules.length, 0)
    assert.equal((await call('/api/schedules/unknown', 'DELETE')).status, 404)
  } finally {
    server.kill()
    if (server.exitCode === null) await once(server, 'exit')
    await rm(root, { recursive: true, force: true })
  }
})
