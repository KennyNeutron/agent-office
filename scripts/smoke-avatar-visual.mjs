// Visual regression capture with an isolated roster. Never starts AI tasks.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const chrome = process.env.CHROME_BIN || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome')
const dataDir = await mkdtemp(join(tmpdir(), 'agent-office-avatar-'))
const listener = createServer()
listener.listen(0, '127.0.0.1')
await once(listener, 'listening')
const port = listener.address().port
await new Promise(done => listener.close(done))
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [resolve('server/index.mjs')], {
  cwd: resolve('.'), env: { ...process.env, PORT: String(port), AGENT_OFFICE_DATA_DIR: dataDir }, windowsHide: true, stdio: 'ignore',
})
const sleep = ms => new Promise(done => setTimeout(done, ms))
const errors = []
let browser

try {
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error('Isolated server failed to start')
    try { ready = (await fetch(origin + '/api/state', { signal: AbortSignal.timeout(500) })).ok } catch { /* startup */ }
    if (ready) break
    await sleep(100)
  }
  assert.ok(ready, 'Isolated server timeout')
  browser = await puppeteer.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-extensions', '--enable-webgl', '--no-first-run', '--no-default-browser-check',
      ...(process.env.SOFTWARE_RENDER === '1' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [])] })
  const page = await browser.newPage()
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewport({ width: 1440, height: 960 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('agent-office-language', 'en'))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 20000 })
  await page.waitForFunction(() => document.querySelectorAll('.crew-card').length === 4)
  await mkdir('work', { recursive: true })

  let zoomed = false
  const focus = async index => {
    await page.$$eval('.crew-card', (cards, number) => cards[number]?.click(), index)
    await sleep(450)
    const frame = await page.$('.scene-frame')
    const rect = await frame.boundingBox()
    assert.ok(rect, 'Office frame must be visible')
    await page.mouse.move(rect.x + rect.width * .52, rect.y + rect.height * .53)
    if (!zoomed) {
      for (let i = 0; i < 8; i++) await page.mouse.wheel({ deltaY: -240 })
      zoomed = true
    }
    await sleep(450)
    return frame
  }
  const capture = async (index, label, { face = false } = {}) => {
    const frame = await focus(index)
    if (face) {
      const rect = await frame.boundingBox()
      assert.ok(rect, 'Office frame must remain visible')
      const x = rect.x + rect.width * .5
      const y = rect.y + rect.height * .56
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + rect.height * .43, y - rect.height * .14, { steps: 24 })
      await page.mouse.up()
      await sleep(650)
    }
    await frame.screenshot({ path: resolve(`work/avatar-${label}.png`) })
  }

  await capture(1, 'working-early')
  await sleep(2300)
  await capture(1, 'working-seated')
  await page.addStyleTag({ content: '.scene-phase-label, .scene-sector-label { visibility: hidden!important; }' })
  await capture(1, 'working-close-unobstructed')
  await capture(0, 'thinking-close')
  await capture(0, 'thinking-front', { face: true })
  await capture(2, 'standing-idle')
  // Wait for the actual 3D avatar to enter a walking stage before capturing.
  // A fixed-delay screenshot used to pass while the agent remained idle.
  await page.waitForFunction(() => document.querySelector('.scene-phase-label[data-agent="pixel"]')?.dataset.walking === 'true',
    { polling: 'raf', timeout: 60000 })
  const walkingSamples = []
  for (let index = 0; index < 8; index++) {
    await sleep(170)
    const sample = await page.$eval('.scene-phase-label[data-agent="pixel"]', el => ({
      x: Number(el.dataset.worldX), z: Number(el.dataset.worldZ), walking: el.dataset.walking === 'true',
    }))
    walkingSamples.push(sample)
    await (await page.$('.scene-frame')).screenshot({ path: resolve(`work/avatar-walk-cycle-${index + 1}.png`) })
  }
  const travel = Math.hypot(walkingSamples.at(-1).x - walkingSamples[0].x, walkingSamples.at(-1).z - walkingSamples[0].z)
  assert.ok(travel > .28, `Captured walk must show real position change; observed ${travel.toFixed(3)}m`)
  assert.ok(walkingSamples.filter(item => item.walking).length >= 4, 'At least half the captured poses must be moving')
  // Verify an idle agent reaches a shared spot (kitchenette, TV, schedule board or games room).
  const AWAY = ['coffee', 'viewing', 'lounging']
  await page.waitForFunction(away => away.includes(document.querySelector('.scene-phase-label[data-agent="pixel"]')?.dataset.movementStage),
    { polling: 'raf', timeout: 240000 }, AWAY)
  // Frame the whole office for a shared-space activity that leaves the desk area.
  await page.click('button.scene-overview-btn')
  await page.waitForFunction(() => document.querySelector('.scene-phase-overlay')?.classList.contains('is-overview'),
    { polling: 'raf', timeout: 5000 })
  await sleep(450)
  const awayLabel = await page.$('.scene-phase-label[data-agent="pixel"]')
  await (await page.$('.scene-frame')).screenshot({ path: resolve('work/avatar-idle-activity.png') })
  const awayActivity = await awayLabel.evaluate(el => el.dataset.idleActivity)
  assert.ok(['coffee', 'schedule', 'tv', 'darts', 'pingpong', 'chess'].includes(awayActivity), `Unexpected away activity: ${awayActivity}`)
  await page.waitForFunction(away => !away.includes(document.querySelector('.scene-phase-label[data-agent="pixel"]')?.dataset.movementStage),
    { polling: 'raf', timeout: 60000 }, AWAY)
  await capture(2, 'idle-after-walking')
  const webgl = await page.$eval('canvas', el => {
    const context = el.getContext('webgl2')
    return { active: Boolean(context), lost: context?.isContextLost() }
  })
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(' | ')}`)
  assert.ok(webgl.active && !webgl.lost, 'WebGL context must remain available')
  console.log(JSON.stringify({ avatarVisual: 'passed', walkingMetersCaptured: Number(travel.toFixed(3)), idleActivity: awayActivity, captures: ['working-early', 'working-seated', 'working-close-unobstructed', 'thinking-close', 'thinking-front', 'standing-idle', ...Array.from({ length: 8 }, (_, index) => `walk-cycle-${index + 1}`), 'idle-activity', 'idle-after-walking'], webgl, consoleErrors: errors.length }))
} finally {
  if (browser) {
    const watchdog = setTimeout(() => browser.process()?.kill(), 7000)
    try { await browser.close() } finally { clearTimeout(watchdog) }
  }
  if (server.exitCode === null) { const exit = once(server, 'exit'); server.kill(); await Promise.race([exit, sleep(5000)]) }
  await rm(dataDir, { recursive: true, force: true })
}
