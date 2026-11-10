import type { OfficeLayout } from './officeLayout'
import { BOARD_ROTATION, scheduleBoardPosition } from './scheduleBoardLayout.ts'

// Shared geometry for idle activities in the service wing: the TV sofa in the
// lounge and the viewing spots in front of the schedule board. Furniture uses
// the same numbers, so routes and seats always line up with what is drawn.

export type Point = [number, number]
export type VisitSpot = { key: string; point: Point; facing: number; approach: Point; lane: Point[] }

/** Two-seat sofa on the east side of the lounge, facing the TV on the west wall. */
export const SOFA = {
  offsetX: 1.35, // seat centres, east of the lounge centre
  seatOffsets: [-.375, .375], // along z; .75 apart keeps seated agents from overlapping
  seatTop: .715, // matches the desk chairs so the seated rig rests on the cushion
  depth: .66,
  length: 1.62,
  approach: .45, // stand point in front of each seat
  laneOffset: .55, // walking lane between the sofa and the coffee table
  entry: 1.6, // lane entry, beyond the sofa's end (z)
}
export const COFFEE_TABLE = { offsetX: -.4, width: .7, depth: 1.4, height: .45 }
/** Wall-mounted TV on the service-wing wall (x = .55), facing east into the lounge. */
export const TV = { wallX: .55, y: 1.62, width: 1.9, height: 1.08, depth: .08 }

const FACING_WEST = -Math.PI / 2

/** Sofa seats for watching TV, or none when the floor has no lounge (fewer than three agents). */
export function tvSeats(layout: OfficeLayout): VisitSpot[] {
  const lounge = layout.amenities.find(item => item.id === 'meeting')
  if (!lounge) return []
  const laneX = lounge.x + SOFA.laneOffset, entryZ = lounge.z + SOFA.entry
  return SOFA.seatOffsets.map((offset, index) => {
    const point: Point = [lounge.x + SOFA.offsetX, lounge.z + offset]
    const approach: Point = [point[0] - SOFA.approach, point[1]]
    return { key: `tv-${index}`, point, facing: FACING_WEST, approach,
      lane: [[layout.spineX, entryZ], [laneX, entryZ], [laneX, point[1]], approach] }
  })
}

/** Two standing spots in front of the schedule board, facing it. */
export function boardSpots(layout: OfficeLayout): VisitSpot[] {
  const [bx, , bz] = scheduleBoardPosition(layout)
  const normal: Point = [Math.sin(BOARD_ROTATION), Math.cos(BOARD_ROTATION)]
  const tangent: Point = [Math.cos(BOARD_ROTATION), -Math.sin(BOARD_ROTATION)]
  const facing = Math.atan2(-normal[0], -normal[1])
  return [.65, -.65].map((offset, index) => {
    const point: Point = [bx + normal[0] * 1.35 + tangent[0] * offset, bz + normal[1] * 1.35 + tangent[1] * offset]
    return { key: `board-${index}`, point, facing, approach: point, lane: [[layout.spineX, point[1]], point] }
  })
}

// ---- Games room (south strip): darts, table tennis and chess. ----
/** Distances inside the games room, measured from its north edge (amenity z) and the floor's west edge. */
export const GAMES = {
  laneZ: .9, // walking lane along the strip
  rowZ: 2.9, // centre line shared by the dartboard, table and chess table
  dartsBoardX: .62, // partition with the board, facing east
  dartsThrow: 2.6, // throw line distance from the board
  tableOffset: 2.97, // table tennis centre, east of the corridor (west player 1 m from it)
  table: { length: 2.74, width: 1.525, height: .76 },
  playerGap: .6, // player stands this far beyond each end of the table
  chessFromEast: 2.1, // chess table centre, from the east edge of the floor
  chessSeat: 1.3, // chair distance from the chess table centre; the stand point clears the table by .42 m
  chessTable: { size: 1.0, height: 1.03 }, // top matches the desks, so seated hands rest on its edge
}

export type GamesRoom = { z: number; laneZ: number; rowZ: number; dartsBoardX: number; tableX: number; chessX: number }
export function gamesRoom(layout: OfficeLayout): GamesRoom | null {
  const room = layout.amenities.find(item => item.id === 'games')
  if (!room) return null
  return { z: room.z, laneZ: room.z + GAMES.laneZ, rowZ: room.z + GAMES.rowZ, dartsBoardX: GAMES.dartsBoardX,
    tableX: layout.spineX + GAMES.tableOffset, chessX: layout.width - GAMES.chessFromEast }
}

const FACING_EAST = Math.PI / 2
const laneTo = (layout: OfficeLayout, room: GamesRoom, approach: Point): Point[] =>
  [[layout.spineX, room.laneZ], [approach[0], room.laneZ], approach]

/** Throw line in front of the dartboard. */
export function dartsSpots(layout: OfficeLayout): VisitSpot[] {
  const room = gamesRoom(layout)
  if (!room) return []
  const point: Point = [room.dartsBoardX + GAMES.dartsThrow, room.rowZ]
  return [{ key: 'darts-0', point, facing: FACING_WEST, approach: point, lane: laneTo(layout, room, point) }]
}

/** One player at each end of the table tennis table, facing each other. */
export function pingPongSpots(layout: OfficeLayout): VisitSpot[] {
  const room = gamesRoom(layout)
  if (!room) return []
  const reach = GAMES.table.length / 2 + GAMES.playerGap
  return [-1, 1].map((side, index) => {
    const point: Point = [room.tableX + side * reach, room.rowZ]
    return { key: `pingpong-${index}`, point, facing: side < 0 ? FACING_EAST : FACING_WEST, approach: point, lane: laneTo(layout, room, point) }
  })
}

/** Two chairs facing each other across the chess table. Agents stand in front of a chair, then sit back into it. */
export function chessSeats(layout: OfficeLayout): VisitSpot[] {
  const room = gamesRoom(layout)
  if (!room) return []
  return [-1, 1].map((side, index) => {
    const point: Point = [room.chessX + side * GAMES.chessSeat, room.rowZ]
    const approach: Point = [room.chessX + side * (GAMES.chessSeat - .38), room.rowZ]
    return { key: `chess-${index}`, point, facing: side < 0 ? FACING_EAST : FACING_WEST, approach, lane: laneTo(layout, room, approach) }
  })
}
