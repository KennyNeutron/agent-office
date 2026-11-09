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
