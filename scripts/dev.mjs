import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { applySharedDataDir } from './shared-data.mjs'

const root = resolve(import.meta.dirname, '..')
const processes = [
  ['API', resolve(root, 'server/index.mjs')],
  ['Web', resolve(root, 'node_modules/vite/bin/vite.js')],
]
console.log(`Agent Office data: ${applySharedDataDir()}`)
const children = []
let shuttingDown = false

function stopAll() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) if (!child.killed) child.kill()
}

for (const [name, entry] of processes) {
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  children.push(child)
  child.on('error', error => {
    console.error(`[${name}] ${error.message}`)
    stopAll()
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[${name}] stopped (${signal || code}).`)
      process.exitCode = code || 1
      stopAll()
    }
  })
}

process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)
