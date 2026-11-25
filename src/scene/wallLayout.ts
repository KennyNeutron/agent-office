import type { OfficeLayout } from './officeLayout'
import { gamesRoom, SOFA, type Point } from './loungeLayout.ts'

// Interior walls, derived from the floor layout so they adapt to team size and
// spacing. Agents and pets follow fixed routes without collision detection, so
// every doorway is cut exactly where a route crosses. Shared with tests.

export const WALL = { thickness: .1, height: 2.4, sill: .95, low: .4 }
/** Solid walls stop at the facades, just outside the floor's north and west edges. */
const FACADE = -.34
/** The service-wing wall runs this far west of the corridor's walking line. */
const WING_OFFSET = .95
const DOOR = 1.1

type Span = [number, number]
export type OfficeWall = {
  key: string
  /** Direction the wall runs in. An 'x' wall sits at a fixed z, and vice versa. */
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
  doors: Span[]
  /** Side (along the fixed axis) of the room this wall fronts. It drops when the camera is on the other side; 0 divides two rooms and stays up. */
  room: -1 | 0 | 1
}

/** The solid stretches of a wall, between its doorways. */
export function wallPieces(wall: OfficeWall): Span[] {
  const pieces: Span[] = []
  let cursor = wall.from
  for (const [start, end] of [...wall.doors].sort((a, b) => a[0] - b[0])) {
    if (start - cursor > .02) pieces.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (wall.to - cursor > .02) pieces.push([cursor, wall.to])
  return pieces
}

export function officeWalls(layout: OfficeLayout): OfficeWall[] {
  if (!layout.seats.length) return []
  const walls: OfficeWall[] = []
  const add = (key: string, axis: 'x' | 'z', at: number, from: number, to: number, room: -1 | 0 | 1, doors: Span[] = []) =>
    walls.push({ key, axis, at, from, to, room, doors: doors.map(([a, b]): Span => [Math.max(from, a), Math.min(to, b)]) })
  const door = (center: number, width = DOOR): Span => [center - width / 2, center + width / 2]

  // Service wing: reception stays open to the corridor; lounge, focus and coffee are rooms.
  const wingX = layout.spineX - WING_OFFSET
  const lounge = layout.amenities.find(item => item.id === 'meeting')
  layout.rows.forEach(({ end }, row) => {
    const coffee = layout.amenities.find(item => item.id === 'coffee' && item.row === row)!
    const focus = layout.amenities.find(item => item.id === 'focus' && item.row === row)
    const previous = row ? layout.rows[row - 1].end : null
    const coffeeWall = coffee.z - .7
    let start = previous ?? coffeeWall
    if (row === 0 && lounge) {
      start = lounge.z - 1.3
      const entry = lounge.z + SOFA.entry
      const loungeEnd = focus ? entry + .42 : coffeeWall
      add('lounge-north', 'x', start, FACADE, wingX, 0)
      add('lounge-front', 'z', wingX, start, loungeEnd, -1, [door(entry, .88)])
      if (focus) add('focus-north', 'x', loungeEnd, FACADE, wingX, 0)
      start = loungeEnd
    }
    if (focus) add(`focus-front-${row}`, 'z', wingX, start, coffeeWall, -1, [door((start + coffeeWall) / 2, 1)])
    add(`coffee-north-${row}`, 'x', coffeeWall, FACADE, wingX, 0)
    add(`coffee-front-${row}`, 'z', wingX, coffeeWall, end, -1, [door(coffee.z + .98)])
    add(`coffee-south-${row}`, 'x', end, FACADE, wingX, row === layout.rows.length - 1 ? -1 : 0)
  })

  // Team bays: one room per bay, entered from the aisle along its south side.
  layout.rows.forEach(({ start, end }, row) => {
    const bays = layout.sectors.filter(sector => sector.row === row).sort((a, b) => a.center[0] - b.center[0])
    const left = bays.map(bay => bay.center[0] - bay.width / 2)
    const north = row ? start + .13 : FACADE
    add(`bay-west-${row}`, 'z', left[0], north, end, 1)
    const dividers = left.slice(1).map(x => x - layout.gap / 2)
    dividers.forEach((x, index) => add(`bay-divider-${row}-${index}`, 'z', x, north, end, 0))
    add(`bay-front-${row}`, 'x', end, left[0], layout.width, -1, left.map((x): Span => [x + .05, x + 1.2]))
    // Later rows back onto an aisle: close the gaps beside each bay's own back wall.
    if (row) bays.forEach((bay, index) => {
      const from = left[index] + bay.width - .18, to = left[index + 1] ?? layout.width
      if (to - from > .25) add(`bay-back-${row}-${index}`, 'x', north, from, to, 1)
    })
  })

  const games = gamesRoom(layout)
  if (games) add('games-front', 'x', games.z, FACADE, layout.width, 1, [door(layout.spineX, 2.2)])
  return walls
}

/** True when walking from a to b, with this much clearance, would cut through a solid part of the wall. */
export function wallBlocks(wall: OfficeWall, a: Point, b: Point, clearance: number): boolean {
  const pad = WALL.thickness / 2 + clearance
  return wallPieces(wall).some(([from, to]) => {
    const along: Span = [from - clearance, to + clearance], across: Span = [wall.at - pad, wall.at + pad]
    const ranges: Span[] = wall.axis === 'x' ? [along, across] : [across, along]
    let enter = 0, leave = 1
    for (const i of [0, 1] as const) {
      const d = b[i] - a[i], [low, high] = ranges[i]
      if (Math.abs(d) < 1e-9) { if (a[i] <= low || a[i] >= high) return false; continue }
      const t1 = (low - a[i]) / d, t2 = (high - a[i]) / d
      enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2))
    }
    return leave - enter > 1e-9
  })
}
