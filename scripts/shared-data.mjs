// The desktop app's data folder (Tauri's app data directory for its identifier).
// Source runs started with `npm run dev:all`, `npm start` or `npm run server` use it
// too, so development shares the installed app's settings, history and knowledge
// base. Set AGENT_OFFICE_DATA_DIR to use another folder (e.g. `.local` for scratch data).
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DESKTOP_IDENTIFIER = 'dev.agentoffice.desktop'

export function desktopDataDir(env = process.env, platform = process.platform) {
  if (platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), DESKTOP_IDENTIFIER)
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', DESKTOP_IDENTIFIER)
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), DESKTOP_IDENTIFIER)
}

/** Points this process (and the children it starts) at the shared data folder. */
export function applySharedDataDir(env = process.env) {
  env.AGENT_OFFICE_DATA_DIR ||= desktopDataDir(env)
  return env.AGENT_OFFICE_DATA_DIR
}
