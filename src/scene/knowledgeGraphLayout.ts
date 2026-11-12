import type { OfficeLayout } from './officeLayout'
import type { OfficeTask } from '../types'

// The knowledge graph sculpture stands just east of the reception counter,
// in front of the reception back wall and west of the central corridor.
// Shared with tests so walking routes provably stay clear of it.

/** Offset from the reception amenity centre. x stays fixed so compact floors keep a gap at the counter. */
const OFFSET: [number, number] = [2.5, -.2]
/** Pedestal footprint radius; the hologram above stays within it. */
export const KNOWLEDGE_RADIUS = .36
/** Radius of the floating node cloud, centred HOLOGRAM_HEIGHT above the floor. */
export const HOLOGRAM_RADIUS = .52
export const HOLOGRAM_HEIGHT = 2.05
/** Label anchor: high above the hologram so it never hides it, nudged east clear of the schedule label. */
export const KNOWLEDGE_LABEL: { dx: number; y: number; dz: number } = { dx: 1.25, y: 3.4, dz: -.85 }
/** How long after an agent's last graph query the sculpture keeps glowing for them. */
export const KNOWLEDGE_RECENT_MS = 45_000

export function knowledgeGraphPosition(layout: OfficeLayout): [number, number, number] {
  const reception = layout.amenities.find(item => item.id === 'reception')
  // Reception x and z are 3.0 and 2.9 times the spacing scale.
  const scale = (reception?.x ?? 3) / 3
  return [(reception?.x ?? 3) + OFFSET[0], 0, (reception?.z ?? 2.9) + OFFSET[1] * scale]
}

// Task events record tool use as "Claude used mcp__graphify__query_graph.",
// "Antigravity used query_graph." or "Finished graphify tool: query_graph." Bare
// generic names (search, fetch) are ignored because other tools share them.
const KNOWLEDGE_TOOL = /graphify|\bquery_graph\b|\bgraph_stats\b/i
export function isKnowledgeEvent(message: string): boolean {
  // Only tool-use events count, never a reply that merely mentions graphify.
  const tool = /^(?:\w+ used (\S+)\.$|(?:Starting|Finished) (\S+ tool: \S+)$)/.exec(message)
  return Boolean(tool && KNOWLEDGE_TOOL.test(tool[1] || tool[2]))
}

/**
 * The graphify tool a knowledge event names, e.g. "query_graph" (MCP prefixes
 * stripped), or null. Codex reports each call twice (Starting/Finished); only
 * the start counts, so every call is listed once.
 */
export function knowledgeTool(message: string): string | null {
  if (!isKnowledgeEvent(message) || message.startsWith('Finished ')) return null
  const name = /^\w+ used (\S+)\.$/.exec(message)?.[1] ?? /tool: (\S+)$/.exec(message)?.[1] ?? ''
  return name.replace(/^mcp__graphify__/, '') || 'graphify'
}

export type KnowledgeQuery = { taskId: string; agentId: string; tool: string; at: number; prompt: string; status: OfficeTask['status'] }
/** Every graphify call recorded in the tasks' events, newest first. */
export function knowledgeQueries(tasks: OfficeTask[]): KnowledgeQuery[] {
  const queries: KnowledgeQuery[] = []
  for (const task of tasks) for (const event of task.events) {
    const tool = knowledgeTool(event.message), at = Date.parse(event.at)
    if (tool && Number.isFinite(at)) queries.push({ taskId: task.id, agentId: task.agentId, tool, at, prompt: task.prompt, status: task.status })
  }
  return queries.sort((a, b) => b.at - a.at)
}

export type KnowledgeReader = { agentId: string; at: number }
/** Running tasks whose agent queried the knowledge graph, newest query first. */
export function knowledgeReaders(tasks: OfficeTask[]): KnowledgeReader[] {
  const readers: KnowledgeReader[] = []
  for (const task of tasks) {
    if (task.status !== 'running') continue
    const event = task.events.findLast(item => isKnowledgeEvent(item.message))
    const at = event ? Date.parse(event.at) : NaN
    if (Number.isFinite(at)) readers.push({ agentId: task.agentId, at })
  }
  return readers.sort((a, b) => b.at - a.at)
}
export const activeReaders = (readers: KnowledgeReader[], now: number) =>
  readers.filter(reader => now - reader.at < KNOWLEDGE_RECENT_MS)

/** Deterministic node cloud (Fibonacci sphere with jittered radius) and nearest-neighbour edges. */
export function knowledgeGeometry(count = 18, radius = HOLOGRAM_RADIUS) {
  const nodes: [number, number, number][] = Array.from({ length: count }, (_, i) => {
    const y = 1 - (i + .5) / count * 2
    const ring = Math.sqrt(1 - y * y), theta = i * 2.39996
    const r = radius * (.72 + ((i * 37) % 10) / 34)
    return [Math.cos(theta) * ring * r, y * r, Math.sin(theta) * ring * r]
  })
  const edges = new Set<string>()
  nodes.forEach((a, i) => {
    const nearest = nodes.map((b, j) => ({ j, d: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }))
      .filter(item => item.j !== i).sort((x, y) => x.d - y.d).slice(0, 2)
    for (const { j } of nearest) edges.add(i < j ? `${i}-${j}` : `${j}-${i}`)
  })
  return { nodes, edges: [...edges].map(key => key.split('-').map(Number) as [number, number]) }
}
