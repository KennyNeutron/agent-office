import type { OfficeLayout } from './officeLayout'
import type { OfficeMotion } from './officePreferences'
import { idleRandom, type Point } from './officeMotion.ts'
import { isSleeping, type OfficeSimulation } from './officeSimulation.ts'
import { petGeometry } from './loungeLayout.ts'

// Office pets: a dog and a cat. Ambient presentation only, like agents' idle
// routines. Pets walk only on lanes agents already use (the games-room lane,
// the central corridor and each bay's aisles), so they never cross furniture.

export type PetKind = 'dog' | 'cat'
/** resting: in its bed. walking: on a path. visiting: beside an agent's desk. napping: curled up by a napping agent. */
export type PetStage = 'resting' | 'walking' | 'visiting' | 'napping'
export type Pet = {
  id: string; kind: PetKind; ordinal: number; bed: Point
  stage: PetStage; position: Point; facing: number; walking: boolean; gait: number
  /** Path being walked, and what happens on arrival. */
  path: Point[]; cursor: number; arrive: PetStage
  /** Agent being visited (desk visit or nap buddy), if any. */
  target: string | null
  wait: number; duration: number; plan: number; blocked: number
}
export type OfficePets = Pet[]

/** Where a pet waits beside an agent: right of the agent's stand point, between desks, facing the agent. */
export const GREET_OFFSET: Point = [.62, .25]
const GREET_FACING = -Math.PI / 2 // facing west, toward the agent
const SPEED: Record<PetKind, number> = { dog: 1.45, cat: 1.05 }
const REST: Record<PetKind, [number, number]> = { dog: [10, 22], cat: [16, 34] }
const VISIT: Record<PetKind, [number, number]> = { dog: [9, 15], cat: [8, 13] }
/** Pets give way to anyone this close ahead of them, for at most PATIENCE seconds. */
const PERSONAL = .62, PATIENCE = 4
const HOME_STAGES = new Set(['standing', 'idling', 'browsing', 'working'])
const asleep = (simulation: OfficeSimulation, id: string | null) => { const actor = id ? simulation.get(id) : undefined; return Boolean(actor && isSleeping(actor)) }

export function createOfficePets(layout: OfficeLayout): OfficePets {
  const geometry = petGeometry(layout)
  if (!geometry || !layout.seats.length) return []
  return (['dog', 'cat'] as const).map((kind, ordinal) => {
    const bed = geometry.beds[kind]
    return { id: kind, kind, ordinal, bed, stage: 'resting', position: [...bed], facing: Math.PI, walking: false, gait: 0,
      path: [], cursor: 0, arrive: 'resting', target: null, wait: 0, duration: 4 + ordinal * 6, plan: 0, blocked: 0 }
  })
}

const pick = (pet: Pet, salt: number, [low, high]: [number, number]) => low + idleRandom(pet.ordinal + 40, pet.plan, salt) * (high - low)

/** From the pet's bed along the games-room lane to the corridor, then to `x, z` on the corridor. */
function bedToCorridor(layout: OfficeLayout, pet: Pet): Point[] {
  const geometry = petGeometry(layout)!
  return [[pet.bed[0], geometry.laneZ], [layout.spineX, geometry.laneZ]]
}

/** Path from the bed to the spot beside an agent's stand point, reusing that agent's own corridor route. */
export function pathToAgent(layout: OfficeLayout, simulation: OfficeSimulation, pet: Pet, agentId: string): Point[] | null {
  const actor = simulation.get(agentId)
  const visit = actor?.plan.excursions.find(route => route.activity !== 'coffee')
  if (!actor || !visit) return null
  // A visit route starts [home, aisle, side aisle, bay front, corridor, ...]: walk it backwards from the corridor.
  const [home, aisle, sideAisle, bayFront, corridor] = visit.points
  const greet = greetPoint(home)
  return [...bedToCorridor(layout, pet), corridor, bayFront, sideAisle, aisle, [greet[0], aisle[1]], greet]
}

/** Path from the bed to the cat's spot in front of the nap couch. */
export function pathToNap(layout: OfficeLayout, pet: Pet): Point[] {
  const geometry = petGeometry(layout)!
  return [...bedToCorridor(layout, pet), [geometry.catNap[0], geometry.laneZ], geometry.catNap]
}

/** Agents who currently have a pet waiting beside their desk. */
export function petVisits(pets: OfficePets): Set<string> {
  return new Set(pets.filter(pet => pet.stage === 'visiting' && pet.target).map(pet => pet.target!))
}

// `path` always starts at the bed; `cursor` indexes the next point (path.length once arrived).
function goHome(pet: Pet) {
  // Retrace the way walked so far, back to the bed.
  pet.path = pet.path.slice(0, pet.cursor).reverse(); pet.cursor = 0; pet.arrive = 'resting'; pet.stage = 'walking'; pet.target = null
}

function depart(pet: Pet, path: Point[], arrive: PetStage, target: string | null) {
  pet.path = [pet.bed, ...path]; pet.cursor = 1; pet.arrive = arrive; pet.stage = 'walking'; pet.target = target; pet.wait = 0
}

export function stepOfficePets(pets: OfficePets, layout: OfficeLayout, simulation: OfficeSimulation, visibleIds: ReadonlySet<string>, dt: number, motion: OfficeMotion) {
  const step = Math.min(Math.max(0, dt), .05)
  for (const pet of pets) {
    pet.walking = false
    if (motion === 'off') {
      // Reduced motion: every pet simply rests in its bed.
      Object.assign(pet, { stage: 'resting', position: [...pet.bed], path: [], cursor: 0, target: null, facing: Math.PI })
      continue
    }
    const pace = motion === 'subtle' ? .45 : 1
    // Like idle agents in the corridors, one pet walks at a time, so pets never meet on a lane.
    const otherWalking = pets.some(other => other !== pet && other.stage === 'walking')
    const sleeper = [...simulation].find(([, actor]) => isSleeping(actor))?.[0] ?? null
    if (pet.stage === 'resting') {
      pet.position = [...pet.bed]; pet.facing = Math.PI
      pet.wait += step * pace
      // The cat goes to keep a napping agent company as soon as it notices.
      if (otherWalking) continue
      if (pet.kind === 'cat' && sleeper && pet.wait > 2) { pet.plan++; depart(pet, pathToNap(layout, pet), 'napping', sleeper); continue }
      if (pet.wait < pet.duration) continue
      pet.plan++
      // Visit someone at their desk (never an agent the other pet is with), or doze a little longer.
      const taken = new Set(pets.filter(other => other !== pet && other.target).map(other => other.target))
      const hosts = [...simulation].filter(([id, actor]) => visibleIds.has(id) && !taken.has(id) && HOME_STAGES.has(actor.state.stage)).map(([id]) => id)
      const host = hosts.length && idleRandom(pet.ordinal + 40, pet.plan, 1) < (pet.kind === 'dog' ? .8 : .55)
        ? hosts[Math.floor(idleRandom(pet.ordinal + 40, pet.plan, 2) * hosts.length)] : null
      const path = host ? pathToAgent(layout, simulation, pet, host) : null
      if (host && path) depart(pet, path, 'visiting', host)
      else { pet.wait = 0; pet.duration = pick(pet, 3, REST[pet.kind]) }
      continue
    }
    if (pet.stage === 'visiting') {
      pet.facing = GREET_FACING
      pet.wait += step * pace
      if (pet.wait >= pet.duration && !otherWalking) goHome(pet)
      continue
    }
    if (pet.stage === 'napping') {
      pet.facing = Math.PI / 2
      // Stay while the agent sleeps, then head back to bed.
      if (!asleep(simulation, pet.target) && !otherWalking) goHome(pet)
      continue
    }
    // A napping agent woke before the cat arrived: turn back.
    if (pet.arrive === 'napping' && !asleep(simulation, pet.target)) { goHome(pet); continue }
    // Walking: give way to people and the other pet just ahead, but never wait forever.
    const target = pet.path[pet.cursor]
    if (!target) { pet.stage = pet.arrive; continue }
    const dx = target[0] - pet.position[0], dz = target[1] - pet.position[1]
    const distance = Math.hypot(dx, dz)
    const travel = Math.min(distance, SPEED[pet.kind] * step)
    const next: Point = distance > 1e-4 ? [pet.position[0] + dx / distance * travel, pet.position[1] + dz / distance * travel] : target
    // A step may not move closer than PERSONAL to someone. People: wait at most PATIENCE (they
    // may be standing still for a while), then squeeze past. Pets: always wait for a pet that has
    // stopped; between two walking pets the lower ordinal (the dog) has right of way, so they never deadlock.
    const closer = (other: Point) => { const after = Math.hypot(next[0] - other[0], next[1] - other[1]); return after < PERSONAL && after < Math.hypot(pet.position[0] - other[0], pet.position[1] - other[1]) }
    const petInWay = pets.some(other => other !== pet && (other.stage !== 'walking' || other.ordinal < pet.ordinal) && closer(other.position))
    const personInWay = [...simulation.values()].some(actor => closer(actor.state.position))
    if (petInWay || (personInWay && pet.blocked < PATIENCE)) { pet.blocked += step; continue }
    pet.blocked = 0
    if (distance > 1e-4) { pet.facing = Math.atan2(dx, dz); pet.walking = true; pet.gait += travel * (Math.PI * 2 / .55) }
    pet.position = next
    if (distance <= SPEED[pet.kind] * step + 1e-4) {
      pet.position = [...target]
      pet.cursor++
      if (pet.cursor >= pet.path.length) {
        pet.stage = pet.arrive; pet.wait = 0
        if (pet.stage === 'visiting') pet.duration = pick(pet, 4, VISIT[pet.kind])
        if (pet.stage === 'resting') { pet.duration = pick(pet, 3, REST[pet.kind]); pet.path = []; pet.cursor = 0 }
      }
    }
  }
}

/** World point beside an agent's stand point where a visiting pet waits. */
export function greetPoint(home: Point): Point {
  return [home[0] + GREET_OFFSET[0], home[1] + GREET_OFFSET[1]]
}
