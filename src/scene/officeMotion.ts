import type { Seat, Sector } from './officeLayout'
import type { OfficeMotion } from './officePreferences'
import type { VisitSpot } from './loungeLayout'

export type Point = [number, number]
/** Idle activities that leave the desk. */
export type Excursion = 'coffee' | 'schedule' | 'tv' | 'darts' | 'pingpong' | 'chess'
/** Everything an idle agent can do. Ambient presentation only: none of it reflects task progress. */
export type IdleActivity = 'desk' | 'stretch' | 'phone' | Excursion
export type VisitStage = 'coffee' | 'resting' | 'viewing' | 'lounging'
export type Route = {
  points: Point[]; durations: number[]; total: number; breakIndex: number; breakStage: VisitStage
  activity: Excursion; spot: string; facing: number; seat?: Point
}
/** Home stand point and every excursion route available to one agent. */
export type ActorPlan = { home: Point; excursions: Route[] }
export type CoffeeStop = { x: number; z: number; aisleZ: number; spineX?: number; key?: string }
export const CHAIR_Z = .94
export const STAND_Z = 1.18
export const STAND_SIDE_X = .98
export const AISLE_Z = 2.32
export const DESK_FACING = Math.PI
// Walking to the front of the chair and sitting are separate phases.
export const CHAIR_APPROACH_Z = .56
const SIT_SECONDS = .72

function timed(points: Point[], breakIndex: number, breakStage: VisitStage, activity: Excursion, spot: string, facing: number, seat?: Point): Route {
  const durations = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]) / 1.3)
  return { points, durations, total: durations.reduce((sum, seconds) => sum + seconds, 0) + 12, breakIndex, breakStage, activity, spot, facing, ...(seat ? { seat } : {}) }
}

// Paths use desk-side aisles and the shared corridor. A coffee visit goes
// around the outside of each bay, then enters the kitchenette from its aisle.
export function makeWalkRoute(seat: Seat, sector: Sector, slot: number, coffee?: CoffeeStop): Route {
  const [x, , z] = seat.position
  const leftEdge = sector.center[0] - sector.width / 2
  // Compact shared rooms have a narrower left margin than department bays.
  // Keep the avatar's shoulders outside the adjacent workstation footprint.
  const sideAisle = leftEdge + .55
  const front = coffee?.aisleZ ?? sector.center[2] + sector.depth / 2 - .88
  const loungeX = leftEdge + 1.2 + (slot % 3) * .65
  const points: Point[] = coffee ? [
    [x + STAND_SIDE_X, z + STAND_Z], [x + STAND_SIDE_X, z + AISLE_Z], [sideAisle, z + AISLE_Z], [sideAisle, front],
    [coffee.spineX ?? sideAisle, front], [coffee.spineX ?? sideAisle, coffee.z + .98],
    [coffee.x, coffee.z + .98],
    [coffee.spineX ?? sideAisle, coffee.z + .98], [coffee.spineX ?? sideAisle, front + .9], [leftEdge - .55, front + .9],
    [leftEdge - .55, z + AISLE_Z], [x + STAND_SIDE_X, z + AISLE_Z], [x + STAND_SIDE_X, z + STAND_Z],
  ] : [
    [x + STAND_SIDE_X, z + STAND_Z], [x + STAND_SIDE_X, z + AISLE_Z], [sideAisle, z + AISLE_Z], [sideAisle, front],
    [loungeX, front], [sideAisle, front], [sideAisle, z + AISLE_Z], [x + STAND_SIDE_X, z + AISLE_Z], [x + STAND_SIDE_X, z + STAND_Z],
  ]
  return timed(points, coffee ? 6 : 4, coffee ? 'coffee' : 'resting', 'coffee', coffee?.key ?? sector.key, DESK_FACING)
}

/**
 * A round trip to a service-wing spot (TV sofa or schedule board): out through the
 * bay aisle and the shared corridor, along the spot's lane, then back the same way.
 */
export function makeVisitRoute(seat: Seat, sector: Sector, front: number, spineX: number, spot: VisitSpot, activity: Exclude<Excursion, 'coffee'>): Route {
  const [x, , z] = seat.position
  const sideAisle = sector.center[0] - sector.width / 2 + .55
  const outbound: Point[] = [[x + STAND_SIDE_X, z + STAND_Z], [x + STAND_SIDE_X, z + AISLE_Z], [sideAisle, z + AISLE_Z], [sideAisle, front], [spineX, front], ...spot.lane]
  const points = [...outbound, ...outbound.slice(0, -1).reverse()]
  // Seated visits (sofa, chess chair) sit back from the stand point into the seat; the rest stand at the spot.
  const seated = activity === 'tv' || activity === 'chess'
  return timed(points, outbound.length - 1, seated ? 'lounging' : 'viewing', activity, spot.key, spot.facing, seated ? spot.point : undefined)
}

export function walkAt(route: Route, seconds: number, motion: OfficeMotion): { position: Point; walking: boolean; resting: boolean; facing: number } {
  const home = route.points[0]
  if (motion === 'off') return { position: home, walking: false, resting: false, facing: Math.PI }
  const factor = motion === 'subtle' ? .55 : 1
  const cycle = route.total / factor
  let remaining = ((seconds % cycle) + cycle) % cycle * factor
  if (remaining < 3) return { position: home, walking: false, resting: false, facing: Math.PI }
  remaining -= 3
  for (let index = 0; index < route.durations.length; index++) {
    if (index === route.breakIndex) {
      if (remaining < 4) return { position: route.points[route.breakIndex], walking: false, resting: true, facing: 0 }
      remaining -= 4
    }
    const duration = route.durations[index]
    if (remaining < duration) {
      const start = route.points[index], end = route.points[index + 1]
      const alpha = duration ? remaining / duration : 1
      return {
        position: [start[0] + (end[0] - start[0]) * alpha, start[1] + (end[1] - start[1]) * alpha],
        walking: duration > .08,
        resting: false,
        facing: Math.atan2(end[0] - start[0], end[1] - start[1]),
      }
    }
    remaining -= duration
  }
  return { position: home, walking: false, resting: false, facing: Math.PI }
}

export type MovementStage = 'standing' | 'idling' | 'walking' | VisitStage | 'returning' | 'approaching' | 'sitting' | 'working' | 'browsing' | 'rising' | 'leaving'
export type MovementState = {
  stage: MovementStage; position: Point; facing: number; seated: number; walking: boolean
  cursor: number; waypoints: Point[]; wait: number; idleTime: number
  /** Current idle activity, or null while working or deciding. */
  activity: IdleActivity | null
  /** Index into the plan's excursions while away from the desk, otherwise -1. */
  excursion: number
  /** Seconds the current activity lasts. For two-player games, only time spent playing counts. */
  duration: number
  /** Seconds spent at a two-player game waiting for a partner. */
  alone: number
  /** Counts decisions, seeding the next pseudo-random choice. */
  plan: number
}

export function createMovementState(plan: ActorPlan | Route): MovementState {
  const home = 'home' in plan ? plan.home : plan.points[0]
  return { stage: 'standing', position: [...home], facing: DESK_FACING, seated: 0,
    walking: false, cursor: 0, waypoints: [], wait: 0, idleTime: 0, activity: null, excursion: -1, duration: 0, alone: 0, plan: 0 }
}

/** Deterministic 0..1 noise, so a scene replays the same choices and tests stay stable. */
export function idleRandom(ordinal: number, plan: number, salt = 0): number {
  let h = Math.imul(ordinal + 1, 0x27d4eb2d) ^ Math.imul(plan + 7, 0x165667b1) ^ Math.imul(salt + 3, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Recreation (TV and the games room) gets the largest share of idle time.
const WEIGHTS: [IdleActivity, number][] = [['desk', 18], ['stretch', 5], ['phone', 6], ['coffee', 8], ['schedule', 5], ['tv', 15], ['darts', 13], ['pingpong', 15], ['chess', 15]]
const DURATION: Record<IdleActivity, [number, number]> = {
  desk: [14, 30], stretch: [4.5, 6.5], phone: [7, 13], coffee: [5, 7], schedule: [5, 8], tv: [35, 70],
  darts: [30, 55], pingpong: [45, 80], chess: [60, 110],
}
/** Games that need two players. Playing time only counts while both are there. */
export const PAIRED: ReadonlySet<Excursion> = new Set(['pingpong', 'chess'])
/** How long a lone player waits for a partner who is not on the way. */
export const PARTNER_PATIENCE = 30
/** Joining someone who is waiting for a game partner beats a random choice this often. */
const JOIN_CHANCE = .75
const pick = (ordinal: number, plan: number, salt: number, [low, high]: [number, number]) => low + idleRandom(ordinal, plan, salt) * (high - low)

/** A two-player game partner: settled and playing, walking over, or absent. */
export type Partner = 'playing' | 'coming' | 'none'
/**
 * Access to shared spots and corridors, decided by the floor simulation.
 * `partner` is the state of the opponent at this agent's game; `waiting` lists
 * two-player games where someone sits alone waiting for an opponent.
 */
export type MovementAccess = { depart?: (route: Route) => boolean; corridor?: boolean; partner?: Partner; waiting?: ReadonlySet<Excursion> }

/** Picks the next idle activity. Excursions only start when their spot and the corridor are free. */
export function chooseIdleActivity(state: MovementState, plan: ActorPlan, ordinal: number, depart: (route: Route) => boolean,
  waiting: ReadonlySet<Excursion> = new Set()): { activity: IdleActivity; excursion: number } {
  // Someone is waiting for an opponent: usually go and join them.
  const invites = plan.excursions.map((route, index) => ({ route, index })).filter(({ route }) => waiting.has(route.activity) && depart(route))
  if (invites.length && idleRandom(ordinal, state.plan, 6) < JOIN_CHANCE) {
    const { route, index } = invites[Math.floor(idleRandom(ordinal, state.plan, 7) * invites.length)]
    return { activity: route.activity, excursion: index }
  }
  const total = WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = idleRandom(ordinal, state.plan, 1) * total
  let activity: IdleActivity = 'desk'
  for (const [name, weight] of WEIGHTS) { if ((roll -= weight) < 0) { activity = name; break } }
  // Variety: avoid repeating the same away-from-desk activity twice in a row.
  if (activity !== 'desk' && activity === state.activity) activity = 'desk'
  if (activity !== 'desk' && activity !== 'stretch' && activity !== 'phone') {
    const options = plan.excursions.map((route, index) => ({ route, index })).filter(({ route }) => route.activity === activity && depart(route))
    if (!options.length) return { activity: 'desk', excursion: -1 }
    return { activity, excursion: options[Math.floor(idleRandom(ordinal, state.plan, 2) * options.length)].index }
  }
  return { activity, excursion: -1 }
}

/**
 * Advances the clock at a visit spot. Two-player games only count time while
 * the partner plays. Alone, the agent waits (indefinitely while the partner is
 * walking over, otherwise up to PARTNER_PATIENCE), and a game ends for both as
 * soon as one player leaves.
 */
function spendVisit(next: MovementState, route: Route, step: number, partner: Partner) {
  if (!PAIRED.has(route.activity) || partner === 'playing') { next.wait += step; next.alone = 0; return }
  if (partner === 'coming' && next.wait === 0) return
  next.alone += step
  if (next.wait > 0 || next.alone >= PARTNER_PATIENCE) next.duration = Math.min(next.duration, next.wait)
}

// A task event changes the movement goal, not the avatar's coordinates.
// While returning, the agent retraces the aisle network instead of cutting
// diagonally through chairs or desks. All pose transitions advance by delta.
export function advanceMovement(state: MovementState, plan: ActorPlan, dt: number, active: boolean,
  motion: OfficeMotion, ordinal: number, access: MovementAccess = {}): MovementState {
  const next: MovementState = { ...state, position: [...state.position], waypoints: [...state.waypoints] }
  const step = Math.min(Math.max(0, dt), .05)
  const home = plan.home
  const chair: Point = [home[0] - STAND_SIDE_X, home[1] + CHAIR_Z - STAND_Z]
  const front: Point = [chair[0], home[1] + CHAIR_APPROACH_Z - STAND_Z]
  const side: Point = [home[0], front[1]]
  const corridor = access.corridor ?? true
  const route = next.excursion >= 0 ? plan.excursions[next.excursion] : undefined
  const still = motion === 'off'
  next.walking = false

  // ---- Goal changes: real tasks always outrank idle routines. ----
  if ((active || still) && route && (next.stage === 'walking' || next.stage === 'resting' || next.stage === 'coffee' || next.stage === 'viewing')) {
    const outbound = next.stage === route.breakStage || next.cursor <= route.breakIndex
    next.waypoints = outbound ? route.points.slice(0, next.cursor).reverse() : route.points.slice(next.cursor)
    next.cursor = 0
    next.stage = 'returning'
  }
  if ((active || still) && next.stage === 'lounging') next.duration = 0
  if ((active || still) && next.stage === 'idling') { next.stage = 'standing'; next.activity = null }
  if (active) {
    if (next.stage === 'browsing') { next.stage = 'working'; next.activity = null }
    if (next.stage === 'rising') next.stage = 'sitting'
    if (next.stage === 'leaving' || next.stage === 'standing') {
      next.stage = 'approaching'
      next.waypoints = [side, front]
      next.cursor = 0
      next.wait = 0
    }
    if (next.stage === 'approaching' || next.stage === 'sitting') next.activity = null
  } else {
    const deskIdle = next.activity === 'desk' && !still
    if (next.stage === 'approaching' && !deskIdle) {
      next.stage = 'leaving'
      next.waypoints = [side, home]
      next.cursor = 0
    }
    if (next.stage === 'working' || (next.stage === 'sitting' && !deskIdle)) {
      if (still) { next.stage = 'rising'; next.wait = 0 }
      // After a task the agent stays at the computer for a while before getting up.
      else if (next.stage === 'working') {
        next.stage = 'browsing'; next.activity = 'desk'; next.wait = 0
        next.duration = pick(ordinal, next.plan++, 3, [6, 14])
      } else next.activity = 'desk'
    }
    if (next.stage === 'browsing' && still) { next.stage = 'rising'; next.wait = 0 }
  }

  // ---- Desk chair: sitting down, working or browsing, rising. ----
  if (next.stage === 'sitting' || next.stage === 'rising') {
    const direction = next.stage === 'sitting' ? 1 : -1
    next.seated = Math.min(1, Math.max(0, next.seated + direction * step / SIT_SECONDS))
    const ease = next.seated * next.seated * (3 - 2 * next.seated)
    next.position = [chair[0], front[1] + (chair[1] - front[1]) * ease]
    next.facing = DESK_FACING
    if (next.seated === 1) {
      next.stage = active ? 'working' : 'browsing'
      next.wait = 0
    }
    if (next.seated === 0) {
      next.stage = 'leaving'
      next.waypoints = [side, home]
      next.cursor = 0
      next.idleTime = 0
    }
    return next
  }
  if (next.stage === 'working' || next.stage === 'browsing') {
    next.position = [...chair]
    next.seated = 1
    next.facing = DESK_FACING
    if (next.stage === 'browsing') {
      next.wait += step * (motion === 'subtle' ? .45 : 1)
      if (next.wait >= next.duration) { next.stage = 'rising'; next.activity = null; next.wait = 0 }
    }
    return next
  }

  // ---- At the desk side: deciding, stretching, checking a phone. ----
  if (next.stage === 'standing') {
    next.position = [...home]
    next.facing = DESK_FACING
    if (!active && !still) {
      next.idleTime += step * (motion === 'subtle' ? .45 : 1)
      // A short, staggered pause so a team does not move in lockstep.
      if (next.idleTime > 1.2 + (ordinal * 7 % 9) * .35) {
        const choice = chooseIdleActivity(next, plan, ordinal, access.depart ?? (() => true), access.waiting)
        next.idleTime = 0
        next.activity = choice.activity
        next.duration = pick(ordinal, next.plan, 4, DURATION[choice.activity])
        next.plan++
        next.wait = 0
        if (choice.activity === 'desk') {
          next.stage = 'approaching'
          next.waypoints = [side, front]
          next.cursor = 0
        } else if (choice.excursion >= 0) {
          next.stage = 'walking'
          next.excursion = choice.excursion
          next.cursor = 1
          next.alone = 0
        } else next.stage = 'idling'
      }
    }
    return next
  }
  if (next.stage === 'idling') {
    next.position = [...home]
    next.facing = DESK_FACING
    next.wait += step * (motion === 'subtle' ? .45 : 1)
    if (next.wait >= next.duration) { next.stage = 'standing'; next.idleTime = 0; next.wait = 0 }
    return next
  }

  // ---- At a service-wing spot. ----
  const partner = access.partner ?? 'playing'
  if (route && (next.stage === 'resting' || next.stage === 'coffee' || next.stage === 'viewing')) {
    if (next.wait < next.duration) spendVisit(next, route, step, partner)
    next.facing = route.facing
    // Wait for the corridor to clear before heading back.
    if (next.wait < next.duration || !corridor) return next
    next.stage = 'walking'
    next.cursor = route.breakIndex + 1
  }
  if (route && next.stage === 'lounging') {
    const approach = route.points[route.breakIndex], seat = route.seat ?? approach
    next.facing = route.facing
    if (next.wait < next.duration) spendVisit(next, route, step, partner)
    const staying = next.wait < next.duration || (!corridor && !active && !still)
    next.seated = Math.min(1, Math.max(0, next.seated + (staying ? 1 : -1) * step / SIT_SECONDS))
    const ease = next.seated * next.seated * (3 - 2 * next.seated)
    next.position = [approach[0] + (seat[0] - approach[0]) * ease, approach[1] + (seat[1] - approach[1]) * ease]
    if (!staying && next.seated === 0) {
      next.stage = 'walking'
      next.cursor = route.breakIndex + 1
    }
    return next
  }

  if (next.stage === 'approaching' || next.stage === 'leaving') {
    const target = next.waypoints[next.cursor]
    if (!target) {
      next.stage = next.stage === 'approaching' ? 'sitting' : 'standing'
      next.cursor = 0
      next.position = next.stage === 'sitting' ? [...front] : [...home]
      next.facing = DESK_FACING
      return next
    }
    const dx = target[0] - next.position[0], dz = target[1] - next.position[1]
    const distance = Math.hypot(dx, dz)
    const speed = 1.1 * step
    if (distance > .0001) {
      const travel = Math.min(distance, speed)
      next.position = [next.position[0] + dx / distance * travel, next.position[1] + dz / distance * travel]
      next.facing = Math.atan2(dx, dz)
      next.walking = true
    }
    if (distance <= speed + .0001) {
      next.position = [...target]
      next.cursor++
      if (next.cursor === next.waypoints.length) {
        next.stage = next.stage === 'approaching' ? 'sitting' : 'standing'
        next.cursor = 0
        next.facing = DESK_FACING
      }
    }
    return next
  }

  // ---- Walking an excursion route, or returning along walkways. ----
  const finish = () => {
    next.stage = 'standing'
    next.cursor = 0
    next.position = [...home]
    next.idleTime = 0
    next.excursion = -1
    next.waypoints = []
  }
  const returning = next.stage === 'returning'
  const points = returning ? next.waypoints : route?.points ?? []
  if (returning && points.length === 0) { finish(); return next }
  const target = points[next.cursor]
  if (!target || !route && !returning) { finish(); return next }
  const dx = target[0] - next.position[0], dz = target[1] - next.position[1]
  const distance = Math.hypot(dx, dz)
  if (distance > .0001) {
    const travel = Math.min(distance, 1.35 * step)
    next.position = [next.position[0] + dx / distance * travel, next.position[1] + dz / distance * travel]
    next.facing = Math.atan2(dx, dz)
    next.walking = true
  }
  if (distance <= 1.35 * step + .0001) {
    next.position = [...target]
    next.cursor++
    if (!returning && route && next.cursor === route.breakIndex + 1) {
      next.stage = route.breakStage
      next.wait = 0
      next.alone = 0
      next.walking = false
      next.facing = route.facing
      if (next.duration <= 0) next.duration = pick(ordinal, next.plan, 5, DURATION[route.activity])
    }
    else if (next.cursor >= points.length) finish()
  }
  return next
}
