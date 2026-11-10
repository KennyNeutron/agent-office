import puppeteer from 'puppeteer-core'
import { strict as assert } from 'node:assert'
import { PNG } from 'pngjs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DEFAULT_AGENTS } from '../server/agents.mjs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function unitRegressions() {
  // Load the actual frontend helpers in memory; no generated files or browser/server processes.
  const require = createRequire(import.meta.url), cache = new Map(), storage = new Map()
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const navigator = { languages: ['en'] }
  function load(file) {
    const path = resolve(file)
    if (cache.has(path)) return cache.get(path).exports
    const module = { exports: {} }
    cache.set(path, module)
    const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText
    const localRequire = id => {
      if (!id.startsWith('.')) return require(id)
      const target = resolve(dirname(path), id)
      const candidate = [target, target + '.ts', target + '.tsx'].find(existsSync)
      assert.ok(candidate, `Unit import missing: ${id}`)
      return load(candidate)
    }
    runInNewContext(source, { module, exports: module.exports, require: localRequire, localStorage, navigator, crypto, console }, { filename: path })
    return module.exports
  }
  const data = load('src/components/dataFlow.ts'), roster = load('src/demo/roster.ts')
  const language = load('src/locales/i18n.ts'), agents = load('src/agents.tsx')
  const checks = []
  async function check(name, body) { await body(); checks.push(name) }
  await check('interface is English-only', () => {
    assert.equal(language.locale, 'en')
    assert.equal(language.languages, undefined)
    assert.equal(agents.displayAgentText({ ...DEFAULT_AGENTS[0], id: 'visitor', role: 'Developer' }, 'role', text => 'translated ' + text), 'Developer')
  })
  await check('roster corrupt, duplicate, empty and blocked storage', () => {
    const key = 'agent-office-public-demo-roster-v1'
    for (const bad of ['{broken', '{}', JSON.stringify([DEFAULT_AGENTS[0], DEFAULT_AGENTS[0]])]) {
      storage.set(key, bad); assert.equal(roster.loadDemoRoster().length, 4)
    }
    storage.set(key, '[]'); assert.equal(roster.loadDemoRoster().length, 0)
    const getItem = localStorage.getItem, setItem = localStorage.setItem
    localStorage.getItem = () => { throw Error('blocked') }
    localStorage.setItem = () => { throw Error('blocked') }
    assert.equal(roster.loadDemoRoster().length, 4)
    assert.doesNotThrow(() => roster.saveDemoRoster([]))
    localStorage.getItem = getItem; localStorage.setItem = setItem
  })
  await check('roster rejects invalid colors, control characters and departments', () => {
    assert.equal(roster.validateDemoAgent({ ...DEFAULT_AGENTS[0], color: 'bad' }), false)
    assert.equal(roster.validateDemoAgent({ ...DEFAULT_AGENTS[0], name: 'bad\nname' }), false)
    assert.equal(roster.validateDemoAgent({ ...DEFAULT_AGENTS[0], department: 'unknown' }), false)
  })
  await check('absolute workspace paths', () => {
    for (const path of ['C:\\project', 'D:/project', '/tmp/project', '\\\\host\\share']) assert.equal(data.isAbsoluteWorkspace(path), true, path)
    for (const path of ['', 'relative/project', 'C:relative', ' ' + 'C:\\project', '/'.repeat(1001)]) assert.equal(data.isAbsoluteWorkspace(path), false, path)
  })
  await check('state schema and duplicate identities', () => {
    const state = baseState()
    assert.equal(data.isServerState(state), true)
    assert.equal(data.isServerState({ ...state, agents: [state.agents[0], state.agents[0]] }), false)
    assert.equal(data.isServerState({ ...state, tasks: null }), false)
    assert.equal(data.isServerState({ ...state, providers: [{}] }), false)
  })
  await check('malformed task payloads', () => {
    assert.equal(data.isOfficeTask(null), false)
    assert.equal(data.isOfficeTask({ id: 'x', events: null }), false)
  })
  await check('non-JSON HTTP errors have safe feedback', async () => {
    await assert.rejects(data.readResponse(new Response('<html>proxy</html>', { status: 503 }), 'Could not start task'), /Could not start task \(HTTP 503\)/)
    await assert.rejects(data.readResponse(new Response('null', { status: 200 }), 'No confirmation'), /No confirmation/)
    await assert.rejects(data.readResponse(new Response(JSON.stringify({ error: 'Synthetic validation error' }), { status: 400 }), 'Failed'), /Synthetic validation error/)
    assert.equal((await data.readResponse(new Response('{"ok":true}'), 'Failed')).ok, true)
  })
  console.log(JSON.stringify({ unitRegressions: 'passed', checks, realAITasks: 0, browserProcesses: 0, networkCalls: 0 }))
}

const providers = [
  { id: 'codex', name: 'Codex CLI', available: false },
  { id: 'claude', name: 'Claude Code', available: false },
  { id: 'antigravity', name: 'Antigravity CLI', available: false },
]
const baseState = () => ({ connected: true, codexAvailable: false, defaultWorkspace: 'C:\\office-smoke',
  providers: structuredClone(providers), agents: structuredClone(DEFAULT_AGENTS), tasks: [] })

if (process.argv.includes('--unit')) {
  await unitRegressions()
  process.exit(0)
}

// Every API request is intercepted. This suite must never touch real jobs or private task history.
async function mockAPI(page, getState, mutate = async () => ({ status: 503, contentType: 'text/plain', body: 'Synthetic proxy error' })) {
  const writes = []
  await page.evaluateOnNewDocument(() => {
    window.__officeStreams = []
    window.EventSource = class extends EventTarget {
      constructor() { super(); this.closed = false; window.__officeStreams.push(this) }
      close() { this.closed = true }
    }
  })
  await page.setRequestInterception(true)
  page.on('request', async request => {
    if (!new URL(request.url()).pathname.startsWith('/api/')) { await request.continue(); return }
    if (request.method() === 'GET') {
      const data = await getState()
      await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {})
    } else {
      writes.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData() })
      await request.respond(await mutate(request)).catch(() => {})
    }
  })
  return writes
}
async function emitState(page, state) {
  await page.evaluate(data => {
    window.__officeStreams.filter(stream => !stream.closed).forEach(stream =>
      stream.dispatchEvent(new MessageEvent('state', { data: JSON.stringify(data) })))
  }, state)
}
async function clickText(page, label) {
  const found = await page.evaluate(text => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(text))
    button?.click(); return Boolean(button)
  }, label)
  assert.ok(found, `Button missing: ${label}`)
}
async function dialogKeyboard(page, opener) {
  await page.focus(opener)
  await page.keyboard.press('Enter')
  await page.waitForSelector('dialog[open]')
  for (let i = 0; i < 18; i++) {
    assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true, 'Tab focus must remain inside the dialog')
    if (i >= 9) await page.keyboard.down('Shift')
    await page.keyboard.press('Tab')
    if (i >= 9) await page.keyboard.up('Shift')
  }
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  assert.equal(await page.$eval(opener, item => item === document.activeElement), true, 'Closing must restore opener focus')
}

async function flowRegressions(browser) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource.*503/.test(message.text())) errors.push(message.text())
  })
  await page.setViewport({ width: 1440, height: 960 })
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('agent-office-language', 'en')
    localStorage.setItem('agent-office-provider', 'claude')
  })
  let state = baseState(), initial = true, invalidState = false, reply = 'error'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const task = (id, status = 'completed', agentId = 'nova') => ({ id, agentId, agentName: agentId === 'nova' ? 'Nova' : agentId,
    provider: 'antigravity', prompt: 'Mission control', workspace: 'C:\\office-smoke', status, phase: status === 'running' ? 'coding' : 'idle',
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:01:00.000Z', finishedAt: status === 'running' ? null : '2026-10-01T12:01:00.000Z',
    lastMessage: '', threadId: null, events: [{ id: id + '-e', kind: 'info', at: '2026-10-01T12:01:00.000Z', message: 'Synthetic activity' }] })
  const response = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  const writes = await mockAPI(page, async () => {
    if (initial) { initial = false; const old = structuredClone(state); await wait(800); return old }
    return invalidState ? { tasks: null } : state
  }, async request => {
    await wait(350)
    if (reply === 'missing') return response({})
    if (reply === 'success') {
      const input = JSON.parse(request.postData())
      const running = { ...task('acknowledged-task', 'running', input.agentId), prompt: input.prompt }
      state.tasks = [{ ...running, status: 'completed', phase: 'idle', finishedAt: running.updatedAt }]
      await emitState(page, state)
      return response({ task: running })
    }
    if (reply === 'agent-race') {
      const input = JSON.parse(request.postData())
      const id = new URL(request.url()).pathname.split('/').at(-1)
      const stale = { ...state.agents.find(agent => agent.id === id), ...input }
      state.agents = state.agents.map(agent => agent.id === id ? { ...stale, role: 'Newest editor' } : agent)
      await emitState(page, state)
      return response({ agent: stale })
    }
    if (reply === 'cancel') {
      state.tasks = state.tasks.map(item => item.status === 'running' ? { ...item, status: 'cancelled', phase: 'idle', finishedAt: item.updatedAt } : item)
      return response({ ok: true })
    }
    return { status: 503, contentType: 'text/plain', body: 'Synthetic proxy error' }
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__officeStreams?.some(stream => !stream.closed))
  state.agents[0].name = 'Fresh Atlas'
  state.providers[2].available = true
  await emitState(page, state)
  await page.click('.mode-btn')
  await wait(1000)
  assert.match(await page.$eval('.crew-card', element => element.textContent), /Fresh Atlas/, 'Late initial HTTP must not replace newer SSE')
  await page.click('.intro .primary-btn')
  await page.type('#prompt', 'Mission control')
  assert.equal(await page.$eval('.modal-bottom .primary-btn', item => item.disabled), true, 'Unavailable stored provider must block launch')
  assert.match(await page.$eval('#task-blocked', item => item.textContent), /Choose an available/)
  await page.select('#task-provider', 'antigravity')
  assert.equal(await page.$eval('.modal-bottom .primary-btn', item => item.disabled), false)
  await page.evaluate(() => window.__officeStreams.filter(stream => !stream.closed).forEach(stream => stream.onerror?.(new Event('error'))))
  await page.waitForFunction(() => document.querySelector('.modal-bottom .primary-btn')?.disabled, { timeout: 5000 })
  assert.equal(await page.$eval('.modal-bottom .primary-btn', item => item.disabled), true, 'Disconnected API must block available provider')
  assert.match(await page.$eval('#task-blocked', item => item.textContent), /API OFFLINE/)
  await emitState(page, state)
  await page.$eval('#mission-dir', item => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(item, '')
    item.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await emitState(page, state)
  assert.equal(await page.$eval('#mission-dir', item => item.value), '', 'Stream refresh must not restore a deliberately cleared workspace')
  assert.equal(await page.$eval('.modal-bottom .primary-btn', item => item.disabled), true)
  await page.type('#mission-dir', 'C:\\office-smoke')
  await page.$eval('.modal-bottom .primary-btn', item => { item.click(); item.click() })
  await page.keyboard.press('Escape')
  assert.ok(await page.$('dialog[open]'), 'Pending request must not dismiss the dialog')
  await page.waitForSelector('#task-error')
  assert.match(await page.$eval('#task-error', item => item.textContent), /Could not start task.*503/)
  assert.equal(writes.length, 1, 'Repeated submit must issue one request')
  assert.equal(await page.$eval('#prompt', item => item.value), 'Mission control', 'Failed launch must preserve the prompt')
  assert.equal(await page.$('.toast-success'), null, 'Request failure must not report success')
  reply = 'missing'
  await page.click('.modal-bottom .primary-btn')
  await page.waitForFunction(() => document.querySelector('#task-error')?.textContent.includes('No confirmation'))
  reply = 'success'
  await page.click('.modal-bottom .primary-btn')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  assert.match(await page.$eval('.execution-inspector .pill-status', item => item.textContent), /Completed/, 'Late launch response must preserve a newer completion event')
  assert.equal(await page.$eval('.execution-prompt', item => item.textContent), 'Antigravity CLI · Mission control')
  await page.click('.crew-card')
  assert.equal(await page.$('.execution-prompt'), null, 'Agent selection must clear the previous task')

  await page.click('[aria-label="Agent team"]')
  await page.click('[aria-label="Edit agent Fresh Atlas"]')
  await page.focus('#agent-role')
  await page.keyboard.down('Control')
  await page.keyboard.press('A')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.type('#agent-role', 'Stale editor')
  reply = 'error'
  await page.click('.modal-bottom .primary-btn')
  await page.waitForSelector('#agent-error')
  assert.equal(await page.$eval('#agent-role', item => item.value), 'Stale editor', 'Failed agent edit must preserve the form')
  assert.ok(await page.$('.toast-error[role="alert"]'))
  reply = 'agent-race'
  await page.click('.modal-bottom .primary-btn')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  assert.match(await page.$eval('.agent-card .agent-role', item => item.textContent), /Newest editor/, 'Late agent response must not overwrite a newer edit')

  state.tasks = [task('finished'), task('stopped', 'cancelled'), task('interrupted', 'interrupted'), task('active', 'running'),
    { ...task('bad-date', 'failed', 'sentinel'), createdAt: 'invalid', updatedAt: 'invalid', finishedAt: 'invalid', events: [{ id: 'bad-e', at: 'invalid', kind: 'error', message: 'Bad time fixture' }] },
    { ...task('archived', 'completed', 'former-worker'), agentName: 'Removed Worker' }]
  await emitState(page, state)
  await page.click('[aria-label="Activity & tasks"]')
  assert.equal(await page.$eval('.search-box input', item => Boolean(item.getAttribute('aria-label'))), true)
  await clickText(page, 'Cancelled')
  assert.equal(await page.$$eval('.detail-task', items => items.length), 1)
  await clickText(page, 'Interrupted')
  assert.equal(await page.$$eval('.detail-task', items => items.length), 1)
  await clickText(page, 'All tasks')
  assert.match(await page.$eval('.detail-task:nth-child(5)', item => item.textContent), /—/, 'Corrupt dates must render a placeholder, not crash')
  await page.click('.detail-task:last-child [aria-label="Show agent"]')
  assert.equal(await page.$eval('.inspector-person strong', item => item.textContent), 'Removed Worker')
  assert.equal(await page.$eval('.assign-btn', item => item.disabled), true, 'Archived agent must not accept assignments')
  await page.click('[aria-label="Activity & tasks"]')
  reply = 'cancel'
  const previousWrites = writes.length
  await page.$eval('.cancel-task', item => { item.click(); item.click() })
  await page.waitForFunction(() => !document.querySelector('.cancel-task'))
  assert.equal(writes.length - previousWrites, 1, 'Cancellation must be deduplicated')
  await emitState(page, { tasks: null })
  assert.ok(await page.$('.connection-message[role="alert"]'), 'Malformed stream must show an error while retaining the last snapshot')
  assert.equal(await page.$$eval('.detail-task', items => items.length), 6)
  invalidState = true
  await page.click('.connection-message button')
  await page.waitForSelector('.connection-message button')
  invalidState = false
  await page.click('.connection-message button')
  await page.waitForFunction(() => !document.querySelector('.connection-message'))

  await page.click('[aria-label="Settings"]')
  for (const width of [320, 390, 768]) {
    await page.setViewport({ width, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Settings overflow at ${width}px`)
  }
  for (const label of ['Agent team', 'Activity & tasks', 'Office studio']) {
    await page.click(`[aria-label="${label}"]`)
    await page.setViewport({ width: 320, height: 844 })
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body *')].filter(item => item.getBoundingClientRect().right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1)
        .slice(0, 12).map(item => ({ tag: item.tagName, class: item.getAttribute('class'), width: item.getBoundingClientRect().width, client: item.clientWidth, scroll: item.scrollWidth })) }))
    if (overflow.scroll > overflow.width + 1) await page.screenshot({ path: resolve('work/ui-overflow.png'), fullPage: true })
    assert.ok(overflow.scroll <= overflow.width + 1, `${label} overflow at 320px: ${JSON.stringify(overflow)}`)
  }
  assert.deepEqual(errors, [], `Flow regression browser errors: ${errors.join(' | ')}`)
  await page.close()

  for (const storage of ['corrupt', 'duplicate', 'blocked', 'empty']) {
    const storagePage = await browser.newPage(), storageErrors = []
    storagePage.on('pageerror', error => storageErrors.push(error.message))
    const storageWrites = await mockAPI(storagePage, baseState)
    await storagePage.evaluateOnNewDocument((kind, defaultAgents) => {
      localStorage.setItem('agent-office-provider', 'not-a-provider')
      localStorage.setItem('agent-office-public-demo-roster-v1', kind === 'corrupt' ? '{broken' : kind === 'duplicate' ? JSON.stringify([defaultAgents[0], defaultAgents[0]]) : '[]')
      if (kind === 'blocked') {
        for (const method of ['getItem', 'setItem']) Object.defineProperty(Storage.prototype, method, { value() { throw new DOMException('Storage blocked', 'SecurityError') } })
      }
    }, storage, DEFAULT_AGENTS)
    await storagePage.goto(url, { waitUntil: 'domcontentloaded' })
    await storagePage.waitForSelector('.intro h1')
    assert.equal(await storagePage.$$eval('.crew-card', items => items.length), storage === 'empty' ? 0 : 4, `${storage} roster recovery`)
    if (storage === 'empty') {
      await storagePage.click('.intro .primary-btn')
      await storagePage.waitForSelector('.team-intro')
      assert.equal(await storagePage.$('dialog'), null, 'Empty roster must lead to agent creation')
    }
    assert.deepEqual(storageWrites, [])
    assert.deepEqual(storageErrors, [])
    await storagePage.close()
  }
  console.log(JSON.stringify({ flowRegressions: 'passed', staleState: true, staleMutations: true, offlineProvider: true,
    nonJSONErrors: true, lostAcknowledgement: true, taskSelection: true, cancelledFilters: true,
    invalidDates: true, storageRecovery: ['corrupt', 'duplicate', 'blocked', 'empty'], keyboardDialogs: true, responsiveWidths: [320, 390, 768], realAITasks: 0 }))
}

const chrome = process.env.CHROME_BIN ||
  (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome')
if (!existsSync(chrome)) throw new Error('Chrome not found. Set CHROME_BIN to its executable.')
const url = process.env.OFFICE_URL || 'http://127.0.0.1:5173/'
const screenshot = process.env.SCREENSHOT_PATH || resolve('screenshots', 'office-smoke.png')
mkdirSync(dirname(screenshot), { recursive: true })
const browser = await puppeteer.launch({
  executablePath: chrome, headless: process.env.CHROME_HEADED !== '1',
  args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--enable-webgl', '--no-sandbox', ...(process.env.SOFTWARE_RENDER === '1' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [])],
  timeout: 30_000,
})

const errors = []
try {
  if (process.argv.includes('--flows-only')) {
    await flowRegressions(browser)
  } else {
  const page = await browser.newPage()
  const demoWrites = await mockAPI(page, baseState)
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem('agent-office-language')) localStorage.setItem('agent-office-language', 'en')
  })
  page.on('pageerror', err => errors.push(err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 })
  // EventSource keeps a connection open; network-idle can time out even
  // when the production app and 3D scene have loaded successfully.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('canvas', { timeout: 15_000 })
  await new Promise(resolve => setTimeout(resolve, 2500))
  assert.match(await page.title(), /Agent Office/i)
  assert.match(await page.$eval('h1', el => el.textContent), /Mission control/i)
  const renderState = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const gl = canvas?.getContext('webgl2')
    return {
      canvas: Boolean(canvas), webgl: Boolean(gl),
      width: canvas?.width, height: canvas?.height,
      canvasRect: canvas?.getBoundingClientRect().toJSON(),
      webglError: gl?.getError(), contextLost: gl?.isContextLost(),
      drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
      avatars: document.querySelectorAll('.crew-card').length,
    }
  })
  assert.equal(renderState.avatars, 4, 'Expected four characters in the team strip')
  assert.equal(renderState.webgl, true, 'WebGL 2 unavailable')
  assert.equal(renderState.contextLost, false, 'WebGL context was lost')
  assert.ok(renderState.drawingBuffer?.[0] > 0, 'WebGL drawing buffer unavailable')
  await page.waitForSelector('.scene-phase-label[data-agent="nova"]')
  await page.waitForFunction(() => document.querySelectorAll('.scene-phase-label').length === 4, { timeout: 12000 })
  const demoPoses = await page.$$eval('.scene-phase-label', badges => Object.fromEntries(
    badges.map(badge => [badge.dataset.agent, badge.dataset.pose])))
  assert.deepEqual(demoPoses, { atlas: 'thinking', nova: 'coding', pixel: 'idle', sentinel: 'idle' },
    'Initial 3D character phases must match Demo tasks')
  // Read the browser's composed screenshot, not the WebGL buffer between frames.
  const sceneElement = await page.$('.scene-frame')
  const sceneImage = PNG.sync.read(await sceneElement.screenshot({ type: 'png' }))
  let lit = 0, dark = 0, contrast = 0, scanned = 0
  for (let y = Math.floor(sceneImage.height * .2); y < Math.floor(sceneImage.height * .85); y += 4) {
    for (let x = Math.floor(sceneImage.width * .1); x < Math.floor(sceneImage.width * .9); x += 4) {
      const i = (y * sceneImage.width + x) * 4
      const peak = Math.max(sceneImage.data[i], sceneImage.data[i + 1], sceneImage.data[i + 2])
      if (peak > 90) lit++
      if (peak < 65) dark++
      if (peak < 215) contrast++
      scanned++
    }
  }
  // The daylight office is intentionally bright; dark-pixel coverage is not
  // a measure of whether the 3D canvas contains actual furnishings/avatars.
  renderState.visualSample = { lit, dark, contrast, scanned }
  await page.screenshot({ path: screenshot, fullPage: true })
  assert.ok(lit > scanned * .02 && contrast > scanned * .035 && dark > scanned * .003,
    `3D scene appears empty (lit=${lit}, dark=${dark}, contrast=${contrast}, samples=${scanned}); inspect ${screenshot}`)

  async function click(text) {
    const clicked = await page.evaluate(label => {
      const button = [...document.querySelectorAll('button')].find(el => el.textContent?.includes(label))
      button?.click()
      return Boolean(button)
    }, text)
    assert.equal(clicked, true, 'Button missing: ' + text)
  }
  assert.match(await page.$eval('.execution-inspector h3', el => el.textContent), /Execution inspector/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.execution-log li').length), 3, 'Expected Nova activity timeline');
  await page.$eval('.crew-card', el => el.click());
  assert.match(await page.$eval('.execution-prompt', el => el.textContent), /Review architecture/);
  await page.$eval('.crew-card:nth-child(2)', el => el.click());
  assert.match(await page.$eval('.execution-prompt', el => el.textContent), /Build the dashboard/);
  await click('New task')
  await page.waitForSelector('[role=dialog]')
  assert.match(await page.$eval('[role=dialog] h2', el => el.textContent), /Create a task/)
  await page.$eval('[aria-label="Close"]', el => el.click())
  await dialogKeyboard(page, '.intro .primary-btn')
  await click('Activity & tasks')
  assert.match(await page.$eval('h1', el => el.textContent), /Activity & tasks/)
  await click('Agent team')
  assert.match(await page.$eval('h1', el => el.textContent), /Meet your agents/)
  await dialogKeyboard(page, '.team-intro .primary-btn')
  await click('Settings')
  assert.match(await page.$eval('h1', el => el.textContent), /Workspace settings/)
  assert.equal(await page.$('#interface-language'), null, 'Language picker must be removed')
  assert.equal(await page.$eval('html', el => el.lang), 'en')
  await page.reload({ waitUntil: 'domcontentloaded' })
  assert.match(await page.$eval('h1', el => el.textContent), /Mission control/)
  // The 3D scene is lazy-loaded: after reload, the heading appears first.
  await page.waitForSelector('.scene-phase-label[data-agent="nova"]', { timeout: 20000 })
  assert.match(await page.$eval('.scene-phase-label[data-agent="nova"]', el => el.textContent), /Coding/, '3D phase badge should show the English phase')
  assert.match(await page.$eval('.task-tile strong', el => el.textContent), /^Build the dashboard/i, 'Bundled demo prompts stay in English')
  await page.$eval('.intro .primary-btn', el => el.click())
  const providerOptions = await page.$$eval('#task-provider option', items => items.map(item => item.value))
  assert.deepEqual(providerOptions, ['codex', 'claude', 'antigravity'], 'Expected three selectable AI providers')
  await page.select('#task-provider', 'claude')
  assert.equal(await page.$eval('#task-provider', el => el.value), 'claude', 'Claude must be selectable')
  await page.select('#task-provider', 'codex')
  await page.type('#prompt', 'Mission control')
  await page.$eval('.modal-bottom .primary-btn', el => el.click())
  assert.equal(await page.$eval('.task-tile strong', el => el.textContent), 'Mission control', 'User-entered prompts must not be translated')
  assert.equal(await page.$eval('.execution-prompt', el => el.textContent), 'Codex CLI · Mission control', 'Inspector must focus selected task and show its provider')
  assert.match(await page.$eval('.execution-inspector h3', el => el.textContent), /Execution inspector/)
  await page.waitForFunction(() => document.querySelectorAll('.execution-log li').length >= 2, { timeout: 6000 })
  assert.match(await page.$eval('.execution-stats', el => el.textContent), /Coding/, 'Demo phase should advance')
  await page.waitForFunction(() => document.querySelector('.scene-phase-label[data-agent="nova"]')?.dataset.pose === 'coding', { timeout: 5000 })
  await page.waitForSelector('.execution-heading .pill-status.completed', { timeout: 12000 })
  assert.equal(await page.$eval('.scene-phase-label[data-agent="nova"]', el => el.dataset.pose), 'coding',
    'Ongoing work must stay visible when an earlier preview task completes')
  await click('Activity & tasks')
  await page.$eval('.detail-task button[aria-label="Show agent"]', el => el.click())
  assert.equal(await page.$eval('.execution-prompt', el => el.textContent), 'Codex CLI · Mission control', 'History must open the exact task')
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await page.$eval('.settings-nav', el => el.click())
  assert.match(await page.$eval('h1', el => el.textContent), /Workspace settings/)
  assert.deepEqual(demoWrites, [], 'Demo actions must make zero API writes')
  await flowRegressions(browser)
  assert.deepEqual(errors, [], 'Browser console errors: ' + errors.join(' | '))
  console.log(JSON.stringify({ ok: true, screenshot, renderState, demoPoses, phaseTransitionsChecked: true, englishOnly: true, mobileSettings: true, pagesChecked: ['studio', 'modal', 'tasks', 'team', 'settings'] }, null, 2))
  }
} finally {
  // The live event stream and WebGL renderer can delay Chromium shutdown.
  // Avoid leaving smoke-test processes running indefinitely after assertions.
  const watchdog = setTimeout(() => browser.process()?.kill(), 10_000)
  try { await browser.close() } finally { clearTimeout(watchdog) }
}
