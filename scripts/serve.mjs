// `npm start` / `npm run server`: the local API (and built UI) on the shared data folder.
import { applySharedDataDir } from './shared-data.mjs'

console.log(`Agent Office data: ${applySharedDataDir()}`)
await import('../server/index.mjs')
