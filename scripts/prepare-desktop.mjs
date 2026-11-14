#!/usr/bin/env node
// Stages everything the desktop app ships besides its Rust shell:
//   src-tauri/resources/app/   the local API (server/), the built UI (dist/) and
//                              its production dependencies (Express)
//   src-tauri/binaries/agent-office-node-<target triple>   the Node.js runtime, as a Tauri sidecar
// Run after `npm run build`. Set AGENT_OFFICE_NODE_BINARY to bundle a specific Node.
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauri = join(root, 'src-tauri')
const stage = join(tauri, 'resources', 'app')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('prepare-desktop: dist/ is missing. Run `npm run build` first.')
  process.exit(1)
}

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
for (const item of ['server', 'dist', 'package.json', 'package-lock.json', 'LICENSE']) {
  cpSync(join(root, item), join(stage, item), { recursive: true })
}
execFileSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' })

const triple = process.env.TAURI_ENV_TARGET_TRIPLE ||
  /^host: (\S+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1]
if (!triple) { console.error('prepare-desktop: could not determine the Rust target triple.'); process.exit(1) }
const node = process.env.AGENT_OFFICE_NODE_BINARY || process.execPath
const sidecar = join(tauri, 'binaries', `agent-office-node-${triple}${process.platform === 'win32' ? '.exe' : ''}`)
mkdirSync(dirname(sidecar), { recursive: true })
cpSync(node, sidecar)
if (process.platform !== 'win32') chmodSync(sidecar, 0o755)
console.log(`prepare-desktop: staged the office in ${stage}\nprepare-desktop: bundled Node ${process.version} as ${sidecar}`)
