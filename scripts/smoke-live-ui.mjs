import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import puppeteer from 'puppeteer-core'

// Opt-in end-to-end test: the UI starts a REAL Codex job and consumes tokens.
// The only requested file write is inside a new, Git-ignored .local directory.
const api = process.env.OFFICE_API_URL || 'http://127.0.0.1:4300'
const url = process.env.OFFICE_URL || 'http://127.0.0.1:5173/'
const chrome = process.env.CHROME_BIN ||
  (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome')
assert.ok(existsSync(chrome), 'Chrome not found. Set CHROME_BIN to its executable.')

const fixture = resolve('.local', `live-ui-smoke-${randomUUID()}`)
const expected = `AGENT_OFFICE_UI_${randomUUID().replaceAll('-', '')}`
const prompt = `Create only the file proof.txt in this folder, containing exactly ${expected} followed by a final newline. Do not modify any other file.`
await mkdir(fixture, { recursive: true })

const initial = await (await fetch(`${api}/api/state`)).json()
assert.equal(initial.codexAvailable, true, 'Start the API with an authenticated Codex CLI')
assert.ok(!initial.tasks.some(task => task.agentId === 'atlas' && task.status === 'running'), 'Atlas is already busy')

const browser = await puppeteer.launch({
  executablePath: chrome, headless: process.env.CHROME_HEADED !== '1',
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--enable-webgl', '--no-sandbox'],
  timeout: 30_000,
})
const errors = []
let taskId
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => localStorage.setItem('agent-office-language', 'en'))
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewport({ width: 1440, height: 960 })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('.scene-phase-label[data-agent="atlas"]', { timeout: 20_000 })
  await page.waitForFunction(() => {
    const badge = document.querySelector('.api-badge')
    return badge?.classList.contains('on') && badge.textContent?.includes('READY')
  })
  await page.$eval('.mode-btn', button => button.click())
  await page.waitForSelector('.mode-btn.live')
  await page.waitForFunction(() => document.querySelector('.scene-phase-label[data-agent="atlas"]')?.dataset.pose === 'idle')

  await page.evaluate(() => {
    const badge = document.querySelector('.scene-phase-label[data-agent="atlas"]')
    window.__officeLivePoses = [badge.dataset.pose]
    new MutationObserver(() => window.__officeLivePoses.push(badge.dataset.pose))
      .observe(badge, { attributes: true, attributeFilter: ['data-pose'] })
  })

  await page.$eval('.intro .primary-btn', button => button.click())
  await page.waitForSelector('[role="dialog"]')
  await page.$eval('.modal-agent-list button', button => button.click()) // Atlas
  await page.type('#prompt', prompt)
  await page.$eval('.mission-project .link-btn', button => button.click()) // Override the office project for this task.
  await page.waitForSelector('#mission-dir')
  await page.$eval('#mission-dir', element => { element.value = ''; element.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.click('#mission-dir', { clickCount: 3 })
  await page.type('#mission-dir', fixture)
  assert.equal(await page.$eval('#mission-dir', element => element.value), fixture)

  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST', { timeout: 20_000 })
  await page.$eval('.modal-bottom .primary-btn', button => button.click())
  const response = await responsePromise
  const body = await response.json()
  assert.equal(response.status(), 201, JSON.stringify(body))
  taskId = body.task.id

  await page.waitForFunction(text => document.querySelector('.execution-prompt')?.textContent?.includes(text), { timeout: 15_000 }, prompt)
  await page.waitForFunction(() => document.querySelectorAll('.execution-log li:not(.execution-no-events)').length >= 1, { timeout: 15_000 })
  await page.waitForFunction(() => document.querySelector('.execution-heading .pill-status.completed'), { timeout: 240_000 })
  await page.waitForFunction(() => window.__officeLivePoses?.includes('celebrating'), { timeout: 10_000 })
  await page.waitForFunction(() => document.querySelector('.scene-phase-label[data-agent="atlas"]')?.dataset.pose === 'idle', { timeout: 13_000 })

  const final = await (await fetch(`${api}/api/state`)).json()
  const task = final.tasks.find(item => item.id === taskId)
  assert.equal(task?.status, 'completed', `Live task failed: ${task?.failure || 'missing'}`)
  assert.equal((await readFile(join(fixture, 'proof.txt'), 'utf8')).trim(), expected)
  assert.ok(task.events.some(event => /comando|arquivo|altera/i.test(event.message)), 'Real command/file activity missing')
  assert.deepEqual(errors, [], 'Browser errors: ' + errors.join(' | '))
  const poses = await page.evaluate(() => [...new Set(window.__officeLivePoses)])
  assert.ok(poses.some(pose => ['thinking', 'coding'].includes(pose)), 'Never observed an active 3D pose')
  console.log(JSON.stringify({ ok: true, mode: 'live', agent: 'atlas', taskId, status: task.status,
    phaseReactions: poses, verifiedOutput: true, timelineEvents: task.events.length, browserErrors: errors.length }, null, 2))
} finally {
  const watchdog = setTimeout(() => browser.process()?.kill(), 10_000)
  try { await browser.close() } finally { clearTimeout(watchdog) }
  if (taskId) {
    const current = await (await fetch(`${api}/api/state`)).json().catch(() => ({ tasks: [] }))
    if (current.tasks.some(task => task.id === taskId && task.status === 'running')) {
      await fetch(`${api}/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }).catch(() => {})
    }
  }
}
