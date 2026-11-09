import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// Live integration test: launches real Codex jobs and consumes tokens.
// All file writes requested from Codex are restricted to fresh, ignored test folders.
const api = process.env.OFFICE_API_URL || 'http://127.0.0.1:4300'
const root = resolve('.local', `live-smoke-${randomUUID()}`)
const specs = [
  { agentId: 'nova', expected: 'AGENT_OFFICE_NOVA_OK' },
  { agentId: 'sentinel', expected: 'AGENT_OFFICE_SENTINEL_OK' },
]

async function post(path, body, options = {}) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

const state = await (await fetch(`${api}/api/state`)).json()
assert.equal(state.codexAvailable, true, 'Start the API with an authenticated Codex CLI')

assert.equal((await post('/api/tasks', { agentId: 'unknown', prompt: 'hello', workspace: root })).status, 400)
assert.equal((await post('/api/tasks', {}, { headers: { Origin: 'https://untrusted.example' } })).status, 403)

const running = []
for (const spec of specs) {
  spec.workspace = join(root, spec.agentId)
  await mkdir(spec.workspace, { recursive: true })
  const prompt = `Create the file proof.txt in this working folder, containing exactly the text ${spec.expected} followed by a final newline. Do not change any other file. Confirm when finished.`
  const response = await post('/api/tasks', { agentId: spec.agentId, prompt, workspace: spec.workspace })
  assert.equal(response.status, 201, `${spec.agentId}: ${JSON.stringify(response.body)}`)
  running.push({ ...spec, id: response.body.task.id })
  console.log(`Started ${spec.agentId}: ${response.body.task.id}`)
  if (spec.agentId === specs[0].agentId) {
    const duplicate = await post('/api/tasks', { agentId: spec.agentId, prompt, workspace: spec.workspace })
    assert.equal(duplicate.status, 409, 'A busy agent accepted duplicate work')
  }
}

const deadline = Date.now() + 240_000
let lastLog = 0
while (Date.now() < deadline) {
  const current = await (await fetch(`${api}/api/state`)).json()
  for (const item of running) {
    const task = current.tasks.find(task => task.id === item.id)
    assert.ok(task, 'Task disappeared from history')
    item.status = task.status
    item.events = task.events
    item.failure = task.failure
  }
  if (running.every(item => item.status !== 'running')) break
  if (Date.now() - lastLog > 15_000) {
    console.log(`Waiting: ${running.map(item => `${item.agentId}=${item.status}`).join(', ')}`)
    lastLog = Date.now()
  }
  await new Promise(resolve => setTimeout(resolve, 2000))
}

for (const item of running) {
  assert.equal(item.status, 'completed', `${item.agentId}: ${item.failure || 'timed out'}`)
  assert.equal((await readFile(join(item.workspace, 'proof.txt'), 'utf8')).trim(), item.expected)
  assert.ok(item.events.some(event => /comando|arquivo|altera/i.test(event.message)), 'No file or command event was streamed')
  console.log(`PASS ${item.agentId}: file and execution events verified`)
}
console.log(`Live integration OK. Isolated fixtures: ${root}`)
