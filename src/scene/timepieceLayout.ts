// Reception timepieces, in the reception group's local coordinates.
// Shared with tests so both stay clear of the desk props and wall fittings.
type Box = { x: number; y: number; z: number; width: number; height: number; depth: number }

/** Desk-top digital clock at the free right end of the reception counter, past the monitor. */
export const DESK_CLOCK: Box & { rotationY: number } = { x: 1.45, y: 1.24 + .13, z: -.05, width: .5, height: .26, depth: .14, rotationY: .3 }
/** Day-and-date calendar hung on the back wall, above the right metal panel. */
export const WALL_CALENDAR: Box = { x: 1.34, y: 2.5, z: -1.045, width: .62, height: .7, depth: .03 }

/** Furniture the timepieces must not intersect (from OfficeCampus Reception). */
export const RECEPTION_PROPS: Record<string, Box> = {
  counterTop: { x: 0, y: 1.19, z: 0, width: 3.5, height: .1, depth: .95 },
  monitor: { x: .8, y: 1.46, z: -.1, width: .67, height: .45, depth: .055 },
  accentPad: { x: -.75, y: 1.252, z: .05, width: .56, height: .02, depth: .35 },
  backWall: { x: 0, y: 2.03, z: -1.13, width: 4.7, height: 1.7, depth: .14 },
  leftPanel: { x: -1.34, y: 1.08, z: -1.03, width: .83, height: 2.12, depth: .06 },
  rightPanel: { x: 1.34, y: 1.08, z: -1.03, width: .83, height: 2.12, depth: .06 },
  sign: { x: 0, y: 2.12, z: -.99, width: .75, height: .35, depth: .018 },
}

const pad = (value: number) => String(value).padStart(2, '0')
/** 24-hour "HH:MM" as shown on the desk clock. */
export function clockText(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
/** Month, day number and weekday as shown on the wall calendar. */
export function calendarText(date: Date): { month: string; day: string; weekday: string } {
  return {
    month: date.toLocaleDateString('en', { month: 'long' }).toUpperCase(),
    day: String(date.getDate()),
    weekday: date.toLocaleDateString('en', { weekday: 'long' }),
  }
}
