// Full browser check of agent management and large 3D teams. No AI tasks are launched.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import puppeteer from 'puppeteer-core'

const chrome = process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome')
const dataDir = await mkdtemp(join(tmpdir(), 'agent-office-browser-'))
const listener = createServer()
listener.listen(0, '127.0.0.1')
await once(listener, 'listening')
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [resolve('server/index.mjs')], {
  cwd: resolve('.'), env: { ...process.env, PORT: String(port), AGENT_OFFICE_DATA_DIR: dataDir }, windowsHide: true, stdio: 'ignore',
})
let browser
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function api(path, method = 'GET', body) {
  const response = await fetch(origin + path, { method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(data)}`)
  return data
}
async function addMany(start, total) {
  const specialties = [
    ['engineering', 'Developer', 'Feature implementation'],
    ['architecture', 'Architect', 'System design'],
    ['design', 'Designer', 'Product interfaces'],
    ['quality', 'QA Engineer', 'Automated tests'],
    ['research', 'Researcher', 'Technical research'],
    ['data', 'Data scientist', 'Analytics'],
    ['operations', 'Operator', 'Deployments'],
    ['general', 'Assistant', 'General support'],
  ]
  await Promise.all(Array.from({ length: total }, (_, i) => api('/api/agents', 'POST', {
    name: `Explorer ${start + i}`, role: specialties[(start + i) % specialties.length][1],
    specialty: specialties[(start + i) % specialties.length][2],
    department: specialties[(start + i) % specialties.length][0], color: '#8b82ff',
  })))
}
const errors = []
try {
  for (let retry = 0; retry < 120; retry++) {
    if (server.exitCode !== null) throw Error('Isolated server exited before starting')
    try { const response = await fetch(origin + '/api/state', { signal: AbortSignal.timeout(500) }); if (response.ok) break } catch { /* wait */ }
    await sleep(80)
    if (retry === 119) throw Error('Isolated server timeout')
  }
  browser = await puppeteer.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-extensions', '--enable-webgl', '--no-first-run', '--no-default-browser-check', ...(process.env.SOFTWARE_RENDER === '1' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [])] })
  const page = await browser.newPage()
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewport({ width: 1440, height: 960 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('agent-office-language', 'en'))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 20000 })
  const count = async number => page.waitForFunction(expected => document.querySelectorAll('.crew-card').length === expected, { timeout: 25000 }, number)
  const phases = async number => page.waitForFunction(expected => document.querySelectorAll('.scene-phase-label').length === expected, { timeout: 25000 }, number)
  await count(4)
  await phases(4)
  await mkdir('work', { recursive: true })
  // Allow walk-to-chair and sit transitions to finish before taking a visual reference.
  await sleep(3200)
  await (await page.$('.scene-frame')).screenshot({ path: resolve('work/office-team-4.png') })
  await page.screenshot({ path: resolve('work/office-preview-page.png'), fullPage: true })
  await page.$eval('.crew-card', element => element.click())
  await sleep(900)
  await (await page.$('.scene-frame')).screenshot({ path: resolve('work/office-seated-focus.png') })
  await page.click('[aria-label="Settings"]')
  await page.waitForSelector('#office-theme')
  await page.select('#office-theme', 'warm')
  await page.select('#office-spacing', 'spacious')
  await page.select('#office-motion', 'off')
  await page.$eval('#office-sector-security', element => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(element, '#c0356a')
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('agent-office-appearance-v1')).sectorColors.security === '#c0356a')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-office-appearance-v1')).theme), 'warm')
  await page.reload({ waitUntil: 'domcontentloaded' })
  // Demo roster edits are browser-only. Real roster checks explicitly select live mode.
  await page.click('.mode-btn')
  await page.click('[aria-label="Settings"]')
  await page.waitForSelector('#office-theme')
  assert.equal(await page.$eval('#office-theme', element => element.value), 'warm', 'Appearance should survive a browser reload')
  assert.equal(await page.$eval('#office-sector-security', element => element.value), '#c0356a', 'Department colors should survive a browser reload')
  await page.click('.office-reset')
  assert.equal(await page.$eval('#office-theme', element => element.value), 'daylight')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-office-appearance-v1')).sectorColors.security), undefined, 'Reset should clear custom department colors')
  await page.click('[aria-label="Office studio"]')
  await page.waitForSelector('[data-office-theme="daylight"][data-office-motion="lively"]')
  await page.click('[aria-label="Agent team"]')
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(el => el.textContent?.includes('Add agent') && !el.disabled))
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(el => el.textContent?.includes('Add agent'))?.click())
  await page.waitForSelector('#agent-name')
  await page.type('#agent-name', 'Firewall')
  await page.type('#agent-role', 'Security engineer')
  await page.type('#agent-specialty', 'Audit code for vulnerabilities')
  assert.equal(await page.$eval('#agent-department', element => element.value), 'security', 'Role should suggest a relevant security sector')
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(el => el.textContent?.includes('Save agent'))?.click())
  await page.waitForFunction(() => document.querySelectorAll('.agent-card').length === 5, { timeout: 15000 })
  const initial = (await api('/api/state')).agents
  assert.equal(initial.length, 5)
  assert.equal(initial.find(agent => agent.name === 'Firewall')?.department, 'security')
  // Manual override must win over automatic role suggestions, and edits must survive reloads.
  await page.click('[aria-label="Edit agent Firewall"]')
  await page.waitForSelector('#agent-department')
  await page.select('#agent-department', 'research')
  await page.type('#agent-role', ' lead')
  assert.equal(await page.$eval('#agent-department', element => element.value), 'research')
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(el => el.textContent?.includes('Save agent'))?.click())
  await page.waitForFunction(() => !document.querySelector('#agent-department'))
  assert.equal((await api('/api/state')).agents.find(agent => agent.name === 'Firewall')?.department, 'research')
  await page.click('[aria-label="Edit agent Firewall"]')
  await page.waitForSelector('#agent-department')
  await page.select('#agent-department', 'security')
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(el => el.textContent?.includes('Save agent'))?.click())
  await page.waitForFunction(() => !document.querySelector('#agent-department'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.click('.mode-btn')
  await page.waitForFunction(() => document.querySelectorAll('.crew-card').length === 5)
  assert.equal((await api('/api/state')).agents.find(agent => agent.name === 'Firewall')?.department, 'security')
  await page.click('[aria-label="Office studio"]')
  await count(5)
  await phases(5)
  await Promise.all(initial.filter(agent => agent.name !== 'Firewall').map(agent => api(`/api/agents/${agent.id}`, 'DELETE')))
  await count(1)
  await phases(1)
  await addMany(1, 19)
  await count(20)
  await phases(20)
  const overview = '[aria-label="Show entire office"]'
  await page.waitForFunction(selector => !document.querySelector(selector), {}, overview)
  await page.$eval('.crew-card:last-child', element => element.click())
  await page.waitForFunction(selector => Boolean(document.querySelector(selector)), {}, overview)
  await (await page.$('.scene-frame')).screenshot({ path: resolve('work/office-workstation-focus.png') })
  await page.click(overview)
  await page.waitForFunction(selector => !document.querySelector(selector), {}, overview)
  await mkdir('work', { recursive: true })
  await page.$eval('.scene-frame', async element => { element.dataset.testReady = 'true' })
  await (await page.$('.scene-frame')).screenshot({ path: resolve('work/office-dynamic-20.png') })
  await page.screenshot({ path: resolve('work/office-overview-page.png'), fullPage: true })
  await addMany(20, 30)
  await count(50)
  await phases(50)
  // Exceed the detailed-rig budget: remaining desks and simplified characters
  // must continue rendering, and focusing a remote worker must still work.
  await addMany(50, 30)
  await count(80)
  await phases(50)
  await (await page.$('.scene-frame')).screenshot({ path: resolve('work/office-dynamic-80.png') })
  await page.$eval('.crew-card:last-child', element => element.click())
  await page.waitForFunction(selector => Boolean(document.querySelector(selector)), {}, overview)
  await page.click(overview)
  await page.waitForFunction(selector => !document.querySelector(selector), {}, overview)
  const renderer = await page.$eval('canvas', canvas => {
    const webgl = canvas.getContext('webgl2')
    return { webgl: Boolean(webgl), lost: webgl?.isContextLost(), width: canvas.width }
  })
  assert.ok(renderer.webgl && !renderer.lost && renderer.width > 0, '3D renderer should survive 80 agents')
  const all = (await api('/api/state')).agents
  assert.equal(all.length, 80)
  await Promise.all(all.map(agent => api(`/api/agents/${agent.id}`, 'DELETE')))
  await count(0)
  await phases(0)
  await page.click('[aria-label="Agent team"]')
  await page.waitForFunction(() => document.body.textContent.includes('No agents yet'))
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(' | ')}`)
  console.log(JSON.stringify({ browser: 'passed', scenarios: [0, 1, 4, 5, 20, 50, 80], automaticSecurityDepartment: true, manualDepartmentOverride: true, persistedEdits: true, appearancePersistence: true, overviewNavigation: true, webgl: renderer, consoleErrors: errors.length, screenshot: 'work/office-dynamic-80.png' }))
} finally {
  if (browser) {
    const watchdog = setTimeout(() => browser.process()?.kill(), 7000)
    try { await browser.close() } finally { clearTimeout(watchdog) }
  }
  if (server.exitCode === null) { const exit = once(server, 'exit'); server.kill(); await Promise.race([exit, sleep(5000)]) }
  await rm(dataDir, { recursive: true, force: true })
}
