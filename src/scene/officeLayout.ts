import type { Department, OfficeAgent } from '../types'
import type { OfficeSpacing } from './officePreferences'

export type Seat = { agent: OfficeAgent; position: [number, number, number]; sector: Department; sectorKey: string; placement: 'lead' | 'team' }
export type Sector = { id: Department; key: string; center: [number, number, number]; width: number; depth: number; count: number; row: number }
export type OfficeAmenity = { id: 'meeting' | 'coffee' | 'focus' | 'reception' | 'games'; key: string; x: number; z: number; aisleZ: number; row: number }
export type OfficeLayout = { sectors: Sector[]; seats: Seat[]; width: number; depth: number; spineX: number; passages: { x: number; z: number; width: number; depth: number }[]; amenities: OfficeAmenity[] }

/** Depth of the games room strip added below the last row of team bays. */
export const GAMES_ROOM_DEPTH = 6

const DEPARTMENT_ORDER: Department[] = ['architecture', 'engineering', 'quality', 'design', 'research', 'data', 'security', 'operations', 'general']

// A seating hint derived only from a declared role, never an execution authority.
export function isLeadRole(role: string): boolean {
  return /\b(lead|leader|manager|director|chief|lider|gerente|diretor|coordenador)\b/i.test(role.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
}

export function makeOfficeLayout(agents: OfficeAgent[], spacing: OfficeSpacing = 'regular'): OfficeLayout {
  const scale = spacing === 'compact' ? .94 : spacing === 'spacious' ? 1.14 : 1
  const sorted = [...agents].sort((a, b) => Number(isLeadRole(b.role)) - Number(isLeadRole(a.role)) ||
    DEPARTMENT_ORDER.indexOf(a.department) - DEPARTMENT_ORDER.indexOf(b.department) || a.id.localeCompare(b.id))
  const groups = agents.length <= 6 ? [{ id: 'general' as Department, agents: sorted }] :
    DEPARTMENT_ORDER.flatMap(id => {
      const team = sorted.filter(agent => agent.department === id)
      return Array.from({ length: Math.ceil(team.length / 9) }, (_, i) => ({ id, agents: team.slice(i * 9, (i + 1) * 9) }))
    })
  const columns = Math.min(groups.length, Math.max(1, Math.ceil(Math.sqrt(groups.length * 1.15))))
  const gap = 2.3 * scale
  const spineX = 7.1 * scale
  const startX = 8.6 * scale
  const geometry = groups.map(group => {
    const desksAcross = Math.min(3, group.agents.length <= 4 ? Math.max(1, Math.ceil(group.agents.length / 2)) : 3)
    const rows = Math.max(1, Math.ceil(group.agents.length / desksAcross))
    return { desksAcross, width: (5.0 + (desksAcross - 1) * 3.75) * scale, depth: (5.0 + (rows - 1) * 4.4) * scale }
  })
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(5 * scale,
    ...geometry.filter((_, i) => i % columns === column).map(item => item.width)))
  const rowCount = Math.ceil(groups.length / columns)
  const rowHeights = Array.from({ length: rowCount }, (_, row) => Math.max((agents.length < 3 ? 10 : 12.6) * scale,
    ...geometry.slice(row * columns, (row + 1) * columns).map(item => item.depth)))
  const rowStarts = rowHeights.map((_, row) => 1.3 * scale + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0))
  const sectors: Sector[] = []
  const seats: Seat[] = []
  const passages: OfficeLayout['passages'] = []
  const amenities: OfficeAmenity[] = [{ id: 'reception', key: 'reception', x: 3.0 * scale, z: 2.9 * scale, aisleZ: 0, row: 0 }]
  groups.forEach((group, index) => {
    const row = Math.floor(index / columns), column = index % columns
    const x = startX + columnWidths.slice(0, column).reduce((sum, width) => sum + width + gap, 0)
    const z = rowStarts[row]
    const { width, depth, desksAcross } = geometry[index]
    const key = `${group.id}-${index}`
    sectors.push({ id: group.id, key, center: [x + width / 2, 0, z + depth / 2], width, depth, count: group.agents.length, row })
    group.agents.forEach((agent, ordinal) => seats.push({ agent, sector: group.id, sectorKey: key,
      placement: isLeadRole(agent.role) ? 'lead' : 'team',
      position: [x + (2.45 + ordinal % desksAcross * 3.75) * scale, 0, z + (2.15 + Math.floor(ordinal / desksAcross) * 4.4) * scale] }))
  })
  const width = Math.max(17.2 * scale, startX + columnWidths.reduce((sum, value) => sum + value, 0) + gap * (columns - 1) + 1.2 * scale)
  const workDepth = rowStarts.at(-1)! + rowHeights.at(-1)! + gap
  // A games room (darts, table tennis, chess) runs along the south edge of the floor.
  const games = agents.length > 0
  const depth = workDepth + (games ? GAMES_ROOM_DEPTH : 0)
  if (games) amenities.push({ id: 'games', key: 'games', x: spineX, z: workDepth, aisleZ: workDepth + .9, row: rowHeights.length })
  rowHeights.forEach((height, row) => {
    const aisleZ = rowStarts[row] + height + .55 * scale
    passages.push({ x: (startX + width) / 2, z: aisleZ + .4 * scale, width: width - startX + 1.2 * scale, depth: 1.7 * scale })
    if (agents.length) amenities.push({ id: 'coffee', key: `coffee-${row}`, x: 3.1 * scale,
      z: rowStarts[row] + height - 1.65 * scale, aisleZ, row })
    if (row === 0 && agents.length >= 3) amenities.push({ id: 'meeting', key: 'meeting', x: 3.0 * scale, z: 7.6 * scale, aisleZ, row })
    if (row > 0 || agents.length >= 25) amenities.push({ id: 'focus', key: `focus-${row}`, x: 3.0 * scale,
      z: row > 0 ? rowStarts[row] + 3.1 * scale : 10.1 * scale, aisleZ, row })
  })
  passages.push({ x: spineX, z: depth / 2, width: 2.2 * scale, depth: depth - 1.2 * scale })
  if (games) passages.push({ x: width / 2, z: workDepth + .9, width: width - 1.2, depth: 1.4 })
  return { sectors, seats, width, depth, spineX, passages, amenities }
}
