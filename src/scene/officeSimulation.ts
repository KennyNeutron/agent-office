import type { OfficeLayout, Seat } from './officeLayout'
import type { OfficeMotion } from './officePreferences'
import { advanceMovement, CHAIR_Z, STAND_SIDE_X, STAND_Z, createMovementState, makeVisitRoute, makeWalkRoute, PAIRED, type ActorPlan, type Excursion, type MovementState, type Partner, type Route } from './officeMotion.ts'
import { boardSpots, chessSeats, dartsSpots, pingPongSpots, tvSeats } from './loungeLayout.ts'

export type OfficeActor = { state: MovementState; plan: ActorPlan; ordinal: number; gait: number; blocked?: boolean }
export type OfficeSimulation = Map<string, OfficeActor>

export function layoutGeometryKey(layout: OfficeLayout): string {
  return JSON.stringify([layout.width, layout.depth, layout.seats.map(seat => [seat.agent.id, seat.position, seat.sectorKey]),
    layout.sectors.map(sector => [sector.key, sector.center, sector.width, sector.depth]), layout.amenities.map(area => [area.key, area.x, area.z, area.aisleZ])])
}

/** The kitchenette route for a seat (its row's coffee point). */
export function routeForSeat(layout: OfficeLayout, seat: Seat, ordinal: number): { route: Route; resource: string } {
  const sector = layout.sectors.find(area => area.key === seat.sectorKey)!
  const coffee = layout.amenities.find(area => area.id === 'coffee' && area.row === sector.row)
  const route = makeWalkRoute(seat, sector, ordinal, coffee && { ...coffee, spineX: layout.spineX })
  return { route, resource: route.spot }
}

/** Every idle excursion for a seat: coffee, the schedule board, the TV sofa (with a lounge) and the games room. */
export function planForSeat(layout: OfficeLayout, seat: Seat, ordinal: number): ActorPlan {
  const sector = layout.sectors.find(area => area.key === seat.sectorKey)!
  const coffeeRoute = routeForSeat(layout, seat, ordinal).route
  const front = coffeeRoute.points[3][1]
  return {
    home: [seat.position[0] + STAND_SIDE_X, seat.position[2] + STAND_Z],
    excursions: [
      coffeeRoute,
      ...boardSpots(layout).map(spot => makeVisitRoute(seat, sector, front, layout.spineX, spot, 'schedule')),
      ...tvSeats(layout).map(spot => makeVisitRoute(seat, sector, front, layout.spineX, spot, 'tv')),
      ...dartsSpots(layout).map(spot => makeVisitRoute(seat, sector, front, layout.spineX, spot, 'darts')),
      ...pingPongSpots(layout).map(spot => makeVisitRoute(seat, sector, front, layout.spineX, spot, 'pingpong')),
      ...chessSeats(layout).map(spot => makeVisitRoute(seat, sector, front, layout.spineX, spot, 'chess')),
    ],
  }
}

// Equivalent snapshots update profiles while preserving world positions and gait.
// Actual geometry changes are atomically rebuilt behind the scene's fade transition.
export function reconcileOfficeSimulation(layout: OfficeLayout, previous: OfficeSimulation = new Map(), activeIds: ReadonlySet<string> = new Set()): OfficeSimulation {
  return new Map(layout.seats.map((seat, ordinal) => {
    const existing = previous.get(seat.agent.id)
    if (existing) return [seat.agent.id, { ...existing, ordinal }]
    const plan = planForSeat(layout, seat, ordinal)
    const state = createMovementState(plan)
    if (activeIds.has(seat.agent.id)) {
      state.stage = 'working'; state.seated = 1
      state.position = [plan.home[0] - STAND_SIDE_X, plan.home[1] + CHAIR_Z - STAND_Z]
    }
    return [seat.agent.id, { plan, ordinal, gait: 0, state }]
  }))
}

const WALKING = new Set(['walking', 'returning'])
const AWAY = new Set(['walking', 'returning', 'resting', 'coffee', 'viewing', 'lounging'])
const VISITING = new Set(['resting', 'coffee', 'viewing', 'lounging'])
/** The shared spot an agent holds while away from the desk, if any. */
export function heldSpot(actor: OfficeActor): string | null {
  return AWAY.has(actor.state.stage) && actor.state.excursion >= 0 ? actor.plan.excursions[actor.state.excursion].spot : null
}
/** Idle excursions walk the corridors one at a time so two agents never meet head-on. */
const usesCorridor = (actor: OfficeActor) => WALKING.has(actor.state.stage) && actor.state.excursion >= 0
const routeOf = (actor: OfficeActor): Route | undefined => actor.state.excursion >= 0 ? actor.plan.excursions[actor.state.excursion] : undefined
/** Settled at its spot and not yet done. */
const settled = (actor: OfficeActor, route: Route) => actor.state.stage === route.breakStage && actor.state.wait < actor.state.duration

/** The opponent at this agent's two-player game: playing, on the way, or absent. */
export function partnerOf(simulation: OfficeSimulation, actor: OfficeActor): Partner {
  const route = routeOf(actor)
  if (!route || !PAIRED.has(route.activity)) return 'none'
  for (const other of simulation.values()) {
    const theirs = routeOf(other)
    if (other === actor || theirs?.activity !== route.activity || theirs.spot === route.spot) continue
    if (settled(other, theirs)) return 'playing'
    if (other.state.stage === 'walking' && other.state.cursor <= theirs.breakIndex) return 'coming'
  }
  return 'none'
}

/** Two-player games where someone sits alone with nobody on the way to join. */
export function gamesWaiting(simulation: OfficeSimulation): Set<Excursion> {
  const waiting = new Set<Excursion>()
  for (const actor of simulation.values()) {
    const route = routeOf(actor)
    if (route && PAIRED.has(route.activity) && settled(actor, route) && actor.state.wait === 0 && partnerOf(simulation, actor) === 'none') waiting.add(route.activity)
  }
  return waiting
}

// Shared spots (each sofa seat, board spot, game position and kitchenette wing)
// host one agent at a time, and only one idle agent walks the corridors at once.
// Chess and table tennis pair two agents: a lone player waits for an opponent,
// and idle agents usually go to join them. Real tasks always outrank idle routines.
export function stepOfficeSimulation(simulation: OfficeSimulation, visibleIds: ReadonlySet<string>, activeIds: ReadonlySet<string>, dt: number, motion: OfficeMotion) {
  const cell = (position: [number, number]) => `${Math.floor(position[0])},${Math.floor(position[1])}`
  const occupied = new Map<string, Set<string>>()
  const occupy = (id: string, position: [number, number]) => {
    const key = cell(position)
    if (!occupied.has(key)) occupied.set(key, new Set())
    occupied.get(key)!.add(id)
  }
  for (const [id, actor] of simulation) occupy(id, actor.state.position)
  const spots = new Set([...simulation.values()].map(heldSpot).filter((spot): spot is string => spot !== null))
  let walkers = [...simulation.values()].filter(usesCorridor).length
  // Agents finishing a visit go home before anyone new sets out.
  const homeward = [...simulation.values()].some(actor => VISITING.has(actor.state.stage) && actor.state.wait >= actor.state.duration)
  const waiting = gamesWaiting(simulation)
  const candidates = [...simulation.entries()].filter(([id, actor]) => visibleIds.has(id) || AWAY.has(actor.state.stage) || activeIds.has(id) ||
    !['standing', 'working', 'browsing', 'idling'].includes(actor.state.stage) || (actor.state.stage === 'working' && !activeIds.has(id)))
    .sort(([a, actorA], [b, actorB]) => Number(activeIds.has(b)) - Number(activeIds.has(a)) || Number(AWAY.has(actorB.state.stage)) - Number(AWAY.has(actorA.state.stage)) ||
      actorB.state.idleTime - actorA.state.idleTime || actorA.ordinal - actorB.ordinal)
  for (const [id, actor] of candidates) {
    const prior = actor.state
    const priorSpot = heldSpot(actor), priorWalking = usesCorridor(actor)
    const next = advanceMovement(prior, actor.plan, dt, activeIds.has(id), motion, actor.ordinal, {
      depart: route => visibleIds.has(id) && !spots.has(route.spot) && walkers === 0 && !homeward,
      corridor: walkers === 0,
      partner: partnerOf(simulation, actor),
      waiting,
    })
    // Personal space: a step may not move closer than .72 m to someone. Stepping
    // away is always allowed. Between two agents who both want to move, the
    // lower ordinal has right of way, so converging walkers can never freeze each other.
    let collides = false
    if (next.walking) {
      const [x, z] = next.position.map(Math.floor)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const otherId of occupied.get(`${x + dx},${z + dz}`) ?? []) {
          if (otherId === id) continue
          const other = simulation.get(otherId)!
          const after = Math.hypot(next.position[0] - other.state.position[0], next.position[1] - other.state.position[1])
          const before = Math.hypot(prior.position[0] - other.state.position[0], prior.position[1] - other.state.position[1])
          const otherMoving = other.state.walking || other.blocked
          if (after < .72 && after < before && (!otherMoving || other.ordinal < actor.ordinal)) collides = true
        }
      }
    }
    actor.blocked = collides
    actor.state = collides ? { ...prior, walking: false } : next
    if (actor.state.walking) actor.gait += Math.hypot(actor.state.position[0] - prior.position[0], actor.state.position[1] - prior.position[1]) * (Math.PI * 2 / 1.2)
    occupied.get(cell(prior.position))?.delete(id)
    occupy(id, actor.state.position)
    const spot = heldSpot(actor)
    if (priorSpot && priorSpot !== spot) spots.delete(priorSpot)
    if (spot) spots.add(spot)
    walkers += Number(usesCorridor(actor)) - Number(priorWalking)
  }
}

/** Someone is settled on the sofa watching. */
export function tvWatched(simulation: OfficeSimulation): boolean {
  for (const actor of simulation.values()) {
    const { stage, excursion, seated } = actor.state
    if (stage === 'lounging' && seated > .6 && actor.plan.excursions[excursion]?.activity === 'tv') return true
  }
  return false
}


/** Spot keys currently in use for an activity by agents settled at the spot (e.g. both table tennis ends). */
export function playersAt(simulation: OfficeSimulation, activity: string): Set<string> {
  const spots = new Set<string>()
  for (const actor of simulation.values()) {
    const { stage, excursion } = actor.state
    const route = excursion >= 0 ? actor.plan.excursions[excursion] : undefined
    if (route?.activity === activity && (stage === 'viewing' || stage === 'lounging')) spots.add(route.spot)
  }
  return spots
}
