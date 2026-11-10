import test from 'node:test'
import assert from 'node:assert/strict'
import { makeOfficeLayout } from '../src/scene/officeLayout.ts'
import { DEFAULT_AGENTS, makeAgent, validateAgent, validStoredAgents } from '../server/agents.mjs'
import { advanceMovement, CHAIR_Z, CHAIR_APPROACH_Z, createMovementState, PAIRED, PARTNER_PATIENCE, STAND_SIDE_X, STAND_Z, walkAt } from '../src/scene/officeMotion.ts'
import { makeAvatarRigPose } from '../src/scene/avatarRig.ts'
import { departmentDecor } from '../src/scene/officeDecor.ts'
import { DEFAULT_OFFICE_PREFERENCES, normalizeOfficePreferences } from '../src/scene/officePreferences.ts'
import { heldSpot, layoutGeometryKey, partnerOf, planForSeat, routeForSeat, reconcileOfficeSimulation, stepOfficeSimulation, tvWatched } from '../src/scene/officeSimulation.ts'
import { boardSpots, chessSeats, COFFEE_TABLE, dartsSpots, GAMES, gamesRoom, NAP_COUCH, napCouch, napSpots, pingPongSpots, PET_BEDS, petGeometry, SOFA, tvSeats } from '../src/scene/loungeLayout.ts'
import { createOfficePets, GREET_OFFSET, pathToAgent, pathToNap, petVisits, stepOfficePets } from '../src/scene/petSimulation.ts'
import { isSleeping } from '../src/scene/officeSimulation.ts'
import { PET_FACING } from '../src/scene/officeMotion.ts'
import { activeReaders, HOLOGRAM_RADIUS, isKnowledgeEvent, KNOWLEDGE_RADIUS, KNOWLEDGE_RECENT_MS, knowledgeGeometry, knowledgeGraphPosition, knowledgeReaders } from '../src/scene/knowledgeGraphLayout.ts'
import { RECEPTION_PROPS } from '../src/scene/timepieceLayout.ts'
import { presentedPose, WORK_POSES } from '../src/scene/agentBehavior.ts'

const departments = ['architecture', 'engineering', 'design', 'quality', 'research', 'operations', 'security', 'data', 'general']

test('department furniture, noticeboards and planters remain disjoint and grounded in narrow pods', () => {
  const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 - .001 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 - .001 && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 - .001
  for (const id of departments) for (const spacing of ['compact', 'regular', 'spacious']) {
    const layout = makeOfficeLayout(makeTeam(10).map(agent => ({ ...agent, department: id })), spacing)
    for (const sector of layout.sectors) {
      const decor = departmentDecor(id, sector.width, sector.depth)
      const boards = decor.boards.map(board => ({ x: board.x, y: board.y, z: board.z, width: board.w + .12, height: board.h + .12, depth: .18 }))
      const objects = [...boards, ...decor.furniture, ...(decor.planter ? [decor.planter] : [])]
      for (const item of decor.furniture) assert.ok(Math.abs(item.y - item.height / 2) < .001, 'standing furniture must touch the floor')
      for (let a = 0; a < objects.length; a++) for (let b = a + 1; b < objects.length; b++) assert.equal(overlaps(objects[a], objects[b]), false, `${id}/${spacing} contextual props intersect`)
      for (const seat of layout.seats.filter(seat => seat.sectorKey === sector.key)) {
        const tabletop = { x: seat.position[0] - sector.center[0], y: .95, z: seat.position[2] - sector.center[2] - .22, width: 2.5, height: .16, depth: 1.32 }
        for (const item of objects) assert.equal(overlaps(item, tabletop), false, `${id}/${spacing} decoration penetrates a workstation`)
      }
    }
  }
})

test('avatar rig connects all limbs and aligns seated hands with mouse and keyboard', () => {
  for (const seated of [0, .25, .5, .75, 1]) {
    for (const activity of ['idle', 'thinking', 'coding', 'researching', 'finishing', 'celebrating', 'error']) {
      const rig = makeAvatarRigPose(seated, false, 1.25, activity)
      assert.equal(rig.arms.length, 2)
      assert.equal(rig.legs.length, 2)
      for (const arm of rig.arms) {
        assert.ok(Math.hypot(...arm.shoulder.map((v, i) => v - arm.elbow[i])) > .1)
        assert.ok(Math.hypot(...arm.elbow.map((v, i) => v - arm.wrist[i])) > .1)
        assert.ok([...arm.shoulder, ...arm.elbow, ...arm.wrist].every(Number.isFinite))
      }
      for (const leg of rig.legs) {
        assert.ok(Math.hypot(...leg.hip.map((v, i) => v - leg.knee[i])) > .1)
        assert.ok(Math.hypot(...leg.knee.map((v, i) => v - leg.ankle[i])) > .1)
        assert.ok([...leg.hip, ...leg.knee, ...leg.ankle, ...leg.foot].every(Number.isFinite))
      }
    }
  }
  const seated = makeAvatarRigPose(1, false, 1.25, 'coding')
  // Rotating the avatar by PI puts its -X hand on the desk's +X mouse.
  const mouseHand = seated.arms[0].wrist
  assert.ok(Math.abs(-mouseHand[0] - .59) < .06, 'hand misses mouse')
  assert.ok(Math.abs(CHAIR_Z - mouseHand[2] - .16) < .06, 'hands miss desktop depth')
  assert.ok(mouseHand[1] > 1.08 && mouseHand[1] < 1.19, 'hands must hover over desk surface')
  assert.ok(Math.abs(seated.arms[1].wrist[0] - .26) < .02, 'other hand misses keyboard')
  const thinking = makeAvatarRigPose(1, false, 1.25, 'thinking')
  assert.ok(Math.abs(thinking.arms[1].wrist[0]) < .025, 'thinking hand must reach chin horizontally')
  assert.ok(Math.abs(thinking.arms[1].wrist[1] - 1.50) < .025, 'thinking hand must reach chin vertically')
  assert.ok(Math.abs(thinking.arms[1].wrist[2] - .27) < .025, 'thinking hand must be near face')
  assert.deepEqual(thinking.arms[0], seated.arms[0], 'thinking must keep mouse hand at desk')
  const beforeThought = makeAvatarRigPose(1, false, 1.25, 'thinking', 0)
  const midThought = makeAvatarRigPose(1, false, 1.25, 'thinking', .5)
  for (let axis = 0; axis < 3; axis++) {
    const expected = (thinking.arms[1].wrist[axis] + beforeThought.arms[1].wrist[axis]) / 2
    assert.ok(Math.abs(midThought.arms[1].wrist[axis] - expected) < .001, 'thinking hand transition must be continuous')
  }
  const idle = makeAvatarRigPose(0, false, 1.25, 'idle')
  assert.deepEqual(idle.arms[0].wrist, [-.4, 1.02, .12],
    'ambient idle animation must keep the arm in a neutral pose instead of inventing conversation')
  assert.ok(idle.bob < .009 && idle.bob > -.009, 'idle breathing must remain subtle')
})

test('walking shoes use alternating planted steps with stable leg lengths', () => {
  const samples = Array.from({ length: 33 }, (_, index) => index * Math.PI * 2 / 32)
  for (const phase of samples) {
    const pose = makeAvatarRigPose(0, 1, 0, 'idle', 0, phase)
    assert.ok(pose.legs.some(leg => Math.abs(leg.foot[1] - .078) < .00001), 'one shoe must remain planted')
    for (const leg of pose.legs) {
      const femur = Math.hypot(...leg.hip.map((n, i) => n - leg.knee[i]))
      const shin = Math.hypot(...leg.knee.map((n, i) => n - leg.ankle[i]))
      assert.ok(Math.abs(femur - .51) < .001, 'femur stretches while walking')
      assert.ok(Math.abs(shin - .50) < .001, 'shin stretches while walking')
      assert.ok(leg.foot[1] >= .078 - 1e-7, 'shoe clips the floor')
      assert.ok(Math.abs(leg.ankle[1] - leg.foot[1] - .105) < 1e-6, 'ankle misses the shoe collar')
      assert.ok(Math.abs(leg.ankle[2] - (leg.foot[2] - .075)) < 1e-6, 'shoe collar detached from ankle')
      assert.ok(leg.knee[1] > .60 && leg.knee[1] < .83, 'walking knee bends into crouch')
    }
  }
  const stopped = makeAvatarRigPose(0, 0, 0, 'idle', 0, 2)
  const moving = makeAvatarRigPose(0, 1, 0, 'idle', 0, 2)
  const settling = makeAvatarRigPose(0, .5, 0, 'idle', 0, 2)
  for (let leg = 0; leg < 2; leg++) {
    assert.ok(Math.abs(settling.legs[leg].foot[2] - (stopped.legs[leg].foot[2] + moving.legs[leg].foot[2]) / 2) < 1e-8)
  }
  for (const seated of [0, .2, .5, .8, 1]) {
    const pose = makeAvatarRigPose(seated, .4, 0, 'coding', 0, 1.7)
    for (const leg of pose.legs) {
      assert.ok(Math.abs(Math.hypot(...leg.hip.map((n, i) => n - leg.knee[i])) - .51) < .001, 'thigh stretches during seating')
      assert.ok(Math.abs(Math.hypot(...leg.knee.map((n, i) => n - leg.ankle[i])) - .50) < .001, 'shin stretches during seating')
      assert.ok(Math.abs(leg.ankle[2] - (leg.foot[2] - .075)) < .001, 'shoe collar separates during seating')
      assert.ok(leg.knee[1] > .63, 'knee sinks through chair cushion during sitting')
      if (seated >= .8) assert.ok(leg.knee[2] > .36, 'knee does not clear the front of the chair during sitting')
      const eased = seated * seated * (3 - 2 * seated)
      assert.ok(Math.abs(leg.hip[1] - (1.16 - eased * .4)) < .001, 'hips do not travel with the pelvis')
    }
    const eased = seated * seated * (3 - 2 * seated)
    assert.ok(Math.abs(pose.torsoDrop - eased * .4) < .001, 'torso is detached from the hip during seating')
  }
})
function makeTeam(count) {
  return Array.from({ length: count }, (_, index) => makeAgent({
    name: `Agent ${index}`, role: `Role ${index}`, specialty: `Specialty ${index}`,
    color: '#6474ab', department: departments[index % departments.length],
  }, `agent-${index}`))
}

function routeFor(layout, seat, ordinal) {
  return routeForSeat(layout, seat, ordinal).route
}

for (const spacing of ['compact', 'regular', 'spacious']) {
  test(`${spacing} modular layout includes connected corridors and valid agent paths`, () => {
    const layout = makeOfficeLayout(makeTeam(90), spacing)
    assert.ok(layout.passages.length > 0)
    assert.equal(layout.seats.length, 90)
    for (const seat of layout.seats) {
      const ordinal = layout.seats.filter(item => item.sector === seat.sector).indexOf(seat)
      const route = routeFor(layout, seat, ordinal)
      for (const phase of [0, 3, 5, 10, 20, 50, 150]) {
        const state = walkAt(route, phase, 'lively')
        assert.ok(Number.isFinite(state.position[0]) && Number.isFinite(state.position[1]))
        assert.ok(state.position[0] >= 0 && state.position[0] <= layout.width, 'route leaves the office width')
        assert.ok(state.position[1] >= 0 && state.position[1] <= layout.depth, 'route leaves the office depth')
      }
      assert.deepEqual(walkAt(route, 12, 'off').position, [seat.position[0] + STAND_SIDE_X, seat.position[2] + STAND_Z])
    }
  })
}

test('walking paths stay outside workstation and chair footprints across multiple team sizes', () => {
  for (const count of [1, 4, 20, 50, 100]) {
    for (const spacing of ['compact', 'regular', 'spacious']) {
      const layout = makeOfficeLayout(makeTeam(count), spacing)
      for (const seat of layout.seats) {
        const ordinal = layout.seats.filter(item => item.sector === seat.sector).indexOf(seat)
        const route = routeFor(layout, seat, ordinal)
        for (let segment = 0; segment < route.points.length - 1; segment++) {
          const [ax, az] = route.points[segment], [bx, bz] = route.points[segment + 1]
          // Sample the entire segment, not only the endpoints (diagonal cuts
          // through furniture are invisible to endpoint-only checks).
          for (let sample = 0; sample <= 12; sample++) {
            const t = sample / 12
            const px = ax + (bx - ax) * t, pz = az + (bz - az) * t
            for (const other of layout.seats) {
              const dx = Math.abs(px - other.position[0]), dz = pz - other.position[2]
              assert.ok(!(dx < 1.35 && dz > -.98 && dz < .55), `desk collision at ${count}/${spacing}/${seat.agent.id}`)
              assert.ok(!(dx < .55 && dz > .65 && dz < 1.67), `chair collision at ${count}/${spacing}/${seat.agent.id}`)
            }
          }
        }
      }
    }
  }
})

test('compact floor retains clear chair approaches, back-row walkways and scaled shared spaces', () => {
  for (const count of [1, 2, 3, 4, 8, 9, 20, 25, 50, 100, 250]) {
    for (const spacing of ['compact', 'regular', 'spacious']) {
      const layout = makeOfficeLayout(makeTeam(count), spacing)
      const farthestBayEdge = Math.max(...layout.sectors.map(sector => sector.center[2] + sector.depth / 2))
      assert.equal(layout.amenities.some(amenity => amenity.id === 'reception'), true)
      assert.equal(layout.amenities.some(amenity => amenity.id === 'meeting'), count >= 3)
      assert.equal(layout.amenities.filter(amenity => amenity.id === 'coffee').length,
        new Set(layout.sectors.map(sector => sector.row)).size)
      if (layout.amenities.length) {
        const meeting = layout.amenities.find(amenity => amenity.id === 'meeting')
        if (meeting) assert.ok(meeting.x + 2.2 < layout.spineX - .5, 'meeting furniture overlaps the circulation spine')
        const coffee = layout.amenities.find(amenity => amenity.id === 'coffee')
        if (coffee) assert.ok(coffee.z + .82 < layout.depth, 'coffee stop leaves the office floor')
        for (const amenity of layout.amenities) {
          assert.ok(amenity.x > 0 && amenity.x < layout.width)
          assert.ok(amenity.z < layout.depth)
        }
      } else assert.ok(layout.depth > farthestBayEdge)
      for (const seat of layout.seats) {
        const sector = layout.sectors.find(item => item.key === seat.sectorKey)
        const ordinal = layout.seats.filter(item => item.sector === seat.sector).indexOf(seat)
        const route = routeFor(layout, seat, ordinal)
        const bayEnd = sector.center[2] + sector.depth / 2
        assert.ok(route.points[3][1] - bayEnd > .4, 'exit route must reach the shared corridor beyond the bay')
        assert.ok(route.points[3][1] - (seat.position[2] + CHAIR_Z + .55) > .6,
          'rear walkway is too close to the last row of chairs')
      }
    }
  }
})

test('corporate floor grows through bounded team pods with a real service wing', () => {
  for (const count of [1, 2, 3, 4, 20]) {
    const team = makeTeam(count).map(agent => ({ ...agent, department: 'engineering' }))
    const layout = makeOfficeLayout(team)
    assert.ok(layout.width >= 17, 'floor must include reception and circulation, not only desks')
    assert.ok(layout.depth >= 13, 'support wing needs usable depth')
    assert.ok(layout.sectors.every(sector => sector.count <= 9), 'large departments must branch into pods instead of an endless desk row')
    if (count <= 6) assert.equal(layout.sectors.length, 1, 'small teams must sit together')
    for (const seat of layout.seats) {
      const sector = layout.sectors.find(item => item.key === seat.sectorKey)
      const left = seat.position[0] - 1.25, right = seat.position[0] + 1.25
      assert.ok(left > sector.center[0] - sector.width / 2 && right < sector.center[0] + sector.width / 2, 'desk exceeds bay bounds')
    }
  }
})

test('work transitions return along walkways, sit at the monitor and rise coherently', () => {
  const layout = makeOfficeLayout(makeTeam(4))
  const seat = layout.seats[0]
  const plan = planForSeat(layout, seat, 0)
  let state = createMovementState(plan)
  // Run idle until the agent is away at a service-wing spot.
  for (let i = 0; i < 20000 && !['coffee', 'viewing', 'lounging'].includes(state.stage); i++) state = advanceMovement(state, plan, .05, false, 'lively', 0)
  assert.ok(['coffee', 'viewing', 'lounging'].includes(state.stage), 'idle agent should eventually leave the desk')
  let sawReturn = false, sawSit = false, sawApproach = false
  for (let i = 0; i < 2000 && state.stage !== 'working'; i++) {
    state = advanceMovement(state, plan, .05, true, 'lively', 0)
    sawReturn ||= state.stage === 'returning' || state.stage === 'walking'
    sawApproach ||= state.stage === 'approaching'
    sawSit ||= state.stage === 'sitting'
    if (state.stage === 'sitting') {
      assert.ok(Math.abs(state.position[0] - seat.position[0]) < .001, 'avatar cannot slide sideways through chair while sitting')
      assert.ok(state.position[1] >= seat.position[2] + CHAIR_APPROACH_Z - .001)
      assert.ok(state.position[1] <= seat.position[2] + CHAIR_Z + .001)
    }
  }
  assert.equal(sawReturn, true)
  assert.equal(sawApproach, true)
  assert.equal(sawSit, true)
  assert.equal(state.stage, 'working')
  assert.equal(state.seated, 1)
  assert.ok(Math.abs(state.position[0] - seat.position[0]) < .001)
  assert.ok(Math.abs(state.position[1] - seat.position[2] - CHAIR_Z) < .001)
  let sawLeave = false
  for (let i = 0; i < 150; i++) {
    state = advanceMovement(state, plan, .05, false, 'off', 0)
    sawLeave ||= state.stage === 'leaving'
    if (state.stage === 'standing') break
  }
  assert.equal(sawLeave, true)
  assert.equal(state.stage, 'standing')
  assert.equal(state.seated, 0)
  assert.deepEqual(state.position, plan.home)
})

test('chess and table tennis need two players: a lone player waits, then both play and leave together', () => {
  const layout = makeOfficeLayout(makeTeam(4))
  const plan = planForSeat(layout, layout.seats[0], 0)
  for (const activity of PAIRED) {
    const excursion = plan.excursions.findIndex(route => route.activity === activity)
    const route = plan.excursions[excursion]
    const atSpot = () => ({ ...createMovementState(plan), stage: 'walking', excursion, cursor: 1, activity, duration: 40 })
    const arrive = (partner) => {
      let state = atSpot()
      for (let i = 0; i < 4000 && state.stage !== route.breakStage; i++) state = advanceMovement(state, plan, .05, false, 'lively', 0, { partner })
      assert.equal(state.stage, route.breakStage)
      return state
    }
    const run = (state, seconds, partner) => {
      for (let i = 0; i < seconds / .05; i++) state = advanceMovement(state, plan, .05, false, 'lively', 0, { partner })
      return state
    }
    // Alone with an opponent on the way: keep waiting, no game time passes.
    let state = run(arrive('coming'), PARTNER_PATIENCE + 10, 'coming')
    assert.equal(state.stage, route.breakStage, `${activity}: waits while the opponent walks over`)
    assert.equal(state.wait, 0)
    // Alone with nobody coming: give up after PARTNER_PATIENCE.
    state = run(arrive('none'), PARTNER_PATIENCE - 2, 'none')
    assert.equal(state.stage, route.breakStage, `${activity}: waits a while for an opponent`)
    state = run(state, 8, 'none')
    assert.ok(state.stage === 'walking' || state.stage === 'returning' || state.stage === 'standing', `${activity}: leaves when nobody comes (${state.stage})`)
    // Playing: time counts; when the opponent leaves, the game is over.
    state = run(arrive('playing'), 10, 'playing')
    assert.ok(state.wait > 9 && state.stage === route.breakStage, `${activity}: plays while the opponent is there`)
    state = run(state, 3, 'none')
    assert.notEqual(state.stage, route.breakStage, `${activity}: leaves once the opponent has gone`)
  }
  // Someone waiting at a game: idle agents usually go to join them.
  const state = createMovementState(plan)
  let joined = 0
  for (let n = 0; n < 200; n++) {
    let next = { ...state, plan: n }
    for (let i = 0; i < 100 && next.stage === 'standing'; i++) next = advanceMovement(next, plan, .05, false, 'lively', 0, { waiting: new Set(['chess']) })
    if (next.stage === 'walking' && plan.excursions[next.excursion].activity === 'chess') joined++
  }
  assert.ok(joined > 120, `idle agents should usually join a waiting chess player (${joined}/200)`)
})

test('idle agents rotate through ambient activities without claiming a conversation or real work', () => {
  const layout = makeOfficeLayout(makeTeam(4))
  const seat = layout.seats[0]
  const plan = planForSeat(layout, seat, 0)
  let state = createMovementState(plan)
  const seen = new Set()
  for (let i = 0; i < 80000; i++) {
    state = advanceMovement(state, plan, .05, false, 'lively', 0)
    assert.notEqual(state.stage, 'chatting', 'idle movement must not enter a conversation stage')
    assert.notEqual(state.stage, 'working', 'idle agents must never appear to work on a task')
    if (state.stage === 'browsing') seen.add('desk')
    if (state.stage === 'idling') seen.add(state.activity)
    if (state.stage === 'coffee') seen.add('coffee')
    const visit = state.excursion >= 0 ? plan.excursions[state.excursion].activity : null
    if (state.stage === 'viewing') seen.add(visit)
    if (state.stage === 'lounging' && state.seated === 1) seen.add(visit)
    if (state.stage === 'lounging') {
      const route = plan.excursions[state.excursion]
      // The nap couch is deeper than a chair: the agent lies down from its stand point in front of it.
      const reach = route.activity === 'nap' ? NAP_COUCH.depth / 2 + NAP_COUCH.approach : Math.max(SOFA.approach, .38)
      assert.ok(Math.hypot(state.position[0] - route.points[route.breakIndex][0], state.position[1] - route.points[route.breakIndex][1]) <= reach + 1e-6, 'seated visits stay between the stand point and the seat')
    }
  }
  // 'pet' only happens when a pet visits, which this single-agent run has none of.
  assert.deepEqual([...seen].sort(), ['chess', 'coffee', 'darts', 'desk', 'nap', 'phone', 'pingpong', 'schedule', 'stretch', 'tv'])
  const sipping = makeAvatarRigPose(0, false, 2, 'idle', 0, 0, 1)
  assert.ok(sipping.arms[1].wrist[1] > 1.3, 'coffee break should lift the mug toward the face')
  // Without a lounge (fewer than three agents) there is no TV, and nobody tries to reach one.
  const small = makeOfficeLayout(makeTeam(2))
  assert.equal(tvSeats(small).length, 0)
  assert.ok(planForSeat(small, small.seats[0], 0).excursions.every(route => route.activity !== 'tv'))
})

test('cancelling and restarting tasks during chair approach preserves continuous movement', () => {
  const layout = makeOfficeLayout(makeTeam(1))
  const plan = planForSeat(layout, layout.seats[0], 0)
  let state = createMovementState(plan)
  const advance = active => {
    const before = state.position
    state = advanceMovement(state, plan, .05, active, 'subtle', 0)
    assert.ok(Math.hypot(state.position[0] - before[0], state.position[1] - before[1]) < .08, 'position jumped between animation phases')
  }
  for (let i = 0; i < 14; i++) advance(true)
  assert.equal(state.stage, 'approaching')
  for (let i = 0; i < 12; i++) advance(false)
  assert.equal(state.stage, 'leaving')
  for (let i = 0; i < 120 && state.stage !== 'working'; i++) advance(true)
  assert.equal(state.stage, 'working')
  // After a task the agent keeps sitting at the computer, then a new task resumes work in place.
  for (let i = 0; i < 6; i++) advance(false)
  assert.equal(state.stage, 'browsing')
  assert.equal(state.seated, 1)
  advance(true)
  assert.equal(state.stage, 'working')
  for (let i = 0; i < 4000 && state.stage !== 'standing'; i++) advance(false)
  assert.equal(state.stage, 'standing', 'browsing ends and the agent gets up again')
})

test('appearance preferences reject invalid persisted values and accept user selections', () => {
  assert.deepEqual(normalizeOfficePreferences(null), DEFAULT_OFFICE_PREFERENCES)
  assert.deepEqual(normalizeOfficePreferences({ theme: 'script', accent: 'url(javascript:bad)', motion: 'flying' }), DEFAULT_OFFICE_PREFERENCES)
  const chosen = normalizeOfficePreferences({ theme: 'warm', spacing: 'spacious', motion: 'off', accent: '#abcdef', social: false })
  assert.equal(chosen.theme, 'warm')
  assert.equal(chosen.spacing, 'spacious')
  assert.equal(chosen.motion, 'off')
  assert.equal('social' in chosen, false, 'obsolete social-animation preference is ignored')
  assert.deepEqual(normalizeOfficePreferences({ sectorColors: { engineering: '#ff1133', hacker: '#ffffff', design: 'red' } }).sectorColors, { engineering: '#ff1133' })
})

test('connecting corridors remain between rooms when one department is much larger', () => {
  const team = makeTeam(2)
  const large = Array.from({ length: 110 }, (_, index) => makeAgent({
    name: `Builder ${index}`, role: 'Developer', specialty: 'Build', color: '#6474ab', department: 'architecture',
  }, `builder-${index}`))
  const layout = makeOfficeLayout([...team, ...large])
  for (const sector of layout.sectors) {
    const coffee = layout.amenities.find(amenity => amenity.id === 'coffee' && amenity.row === sector.row)
    assert.ok(coffee.aisleZ > sector.center[2] + sector.depth / 2, 'each pod needs an unobstructed exit to its wing corridor')
    assert.ok(layout.passages.some(passage => Math.abs(passage.z - coffee.aisleZ) < .5))
  }
})

for (const count of [0, 1, 2, 4, 10, 20, 50, 100, 1000]) {
  test(`office layout seats exactly ${count} agents without collisions`, () => {
    const team = makeTeam(count)
    const layout = makeOfficeLayout(team)
    assert.equal(layout.seats.length, count)
    assert.deepEqual(layout.seats.map(seat => seat.agent.id).sort(), team.map(agent => agent.id).sort())
    const positions = layout.seats.map(seat => seat.position.join(','))
    assert.equal(new Set(positions).size, count)
    assert.ok(layout.sectors.length >= 1 && layout.sectors.every(sector => sector.count <= 9))
    assert.equal(new Set(layout.sectors.map(sector => sector.key)).size, layout.sectors.length)
    for (const seat of layout.seats) {
      const sector = layout.sectors.find(area => area.key === seat.sectorKey)
      assert.ok(sector)
      assert.equal(seat.sector, count <= 6 ? 'general' : seat.agent.department)
      assert.ok(Math.abs(seat.position[0] - sector.center[0]) < sector.width / 2)
      assert.ok(Math.abs(seat.position[2] - sector.center[2]) < sector.depth / 2)
    }
  })
}

test('default legacy agents remain compatible with persisted history', () => {
  assert.deepEqual(DEFAULT_AGENTS.map(agent => agent.id), ['atlas', 'nova', 'pixel', 'sentinel'])
  assert.equal(validStoredAgents(DEFAULT_AGENTS), true)
  assert.equal(validStoredAgents([]), true)
  assert.equal(validStoredAgents(makeTeam(20)), true)
  assert.equal(validStoredAgents([...DEFAULT_AGENTS, DEFAULT_AGENTS[0]]), false)
})

test('snapshot refresh preserves movement, and declarations of leadership only guide seating', () => {
  const layout = makeOfficeLayout(DEFAULT_AGENTS)
  assert.equal(layout.seats[0].agent.id, 'atlas')
  assert.equal(layout.seats[0].placement, 'lead')
  const original = reconcileOfficeSimulation(layout)
  const ids = new Set(layout.seats.map(seat => seat.agent.id))
  for (let i = 0; i < 700; i++) stepOfficeSimulation(original, ids, new Set(), .05, 'lively')
  const refreshed = reconcileOfficeSimulation(makeOfficeLayout(DEFAULT_AGENTS.map(agent => ({ ...agent }))), original)
  for (const [id, actor] of original) assert.equal(refreshed.get(id).state, actor.state, 'SSE refresh must not reset pose or position')
})

test('simultaneous idle routines share spots one at a time, keep distance and release visits for tasks', () => {
  const layout = makeOfficeLayout(makeTeam(20))
  const simulation = reconcileOfficeSimulation(layout)
  const ids = new Set(layout.seats.map(seat => seat.agent.id))
  const visitors = new Set(), activities = new Set(), games = new Set()
  let tvOn = false, pairs = 0
  const solo = new Map()
  // Twenty simulated minutes: trips are one walker at a time and recreation lasts a while, so a busy floor needs time to show every kind.
  for (let i = 0; i < 24000; i++) {
    stepOfficeSimulation(simulation, ids, new Set(), .05, 'lively')
    const spots = new Set()
    let walkers = 0
    for (const [id, actor] of simulation) {
      const spot = heldSpot(actor)
      if (spot) {
        assert.equal(spots.has(spot), false, `only one agent can hold ${spot}`)
        spots.add(spot)
      }
      if (['walking', 'returning'].includes(actor.state.stage) && actor.state.excursion >= 0) walkers++
      if (['coffee', 'viewing', 'lounging'].includes(actor.state.stage)) {
        visitors.add(id); activities.add(actor.state.stage)
        const visit = actor.plan.excursions[actor.state.excursion].activity
        if (['darts', 'pingpong', 'chess'].includes(visit)) games.add(visit)
        // Two-player games only advance while the opponent is there too.
        if (PAIRED.has(visit) && actor.state.wait > 0 && actor.state.wait < actor.state.duration) {
          // The game ends for both within a frame of one player leaving.
          const partner = partnerOf(simulation, actor)
          solo.set(id, partner === 'none' ? (solo.get(id) ?? 0) + 1 : 0)
          assert.ok(solo.get(id) <= 1, `${visit} played without an opponent`)
          if (partner === 'playing') pairs++
        }
      }
      if (actor.state.stage === 'idling') activities.add(actor.state.activity)
      for (const [otherId, other] of simulation) if (otherId !== id) {
        assert.ok(Math.hypot(actor.state.position[0] - other.state.position[0], actor.state.position[1] - other.state.position[1]) >= .72 - 1e-8, 'characters overlap during simultaneous movement')
      }
    }
    assert.ok(walkers <= 1, 'idle agents walk the corridors one at a time')
    tvOn ||= tvWatched(simulation)
  }
  assert.ok(visitors.size >= 4, 'different agents should take turns leaving their desks')
  for (const activity of ['coffee', 'viewing', 'lounging', 'stretch', 'phone']) assert.ok(activities.has(activity), `${activity} should occur on a busy floor`)
  assert.ok(games.size >= 2, `the games room should be used (saw ${[...games]})`)
  assert.ok(pairs > 0, 'chess or table tennis should be played by two agents together')
  assert.equal(tvOn, true, 'the TV switches on while someone watches')
  for (let i = 0; i < 2400; i++) stepOfficeSimulation(simulation, ids, ids, .05, 'lively')
  assert.ok([...simulation.values()].every(actor => actor.state.stage === 'working'), 'new tasks must interrupt visits and return everyone to their desk')
  assert.equal(tvWatched(simulation), false)
})

test('service-wing visit routes stay clear of desks, chairs, the lounge furniture and the reception desk', () => {
  for (const count of [3, 4, 20, 60]) for (const spacing of ['compact', 'regular', 'spacious']) {
    const layout = makeOfficeLayout(makeTeam(count), spacing)
    const lounge = layout.amenities.find(item => item.id === 'meeting')
    const reception = layout.amenities.find(item => item.id === 'reception')
    const blockers = [
      { name: 'sofa', x: lounge.x + SOFA.offsetX + .02, z: lounge.z, w: SOFA.depth + .08, d: SOFA.length + .3 },
      { name: 'coffee table', x: lounge.x + COFFEE_TABLE.offsetX, z: lounge.z, w: COFFEE_TABLE.width, d: COFFEE_TABLE.depth },
      { name: 'reception desk', x: reception.x, z: reception.z, w: 3.5, d: .95 },
    ]
    const room = gamesRoom(layout)
    blockers.push(
      { name: 'dart partition', x: room.dartsBoardX - .06, z: room.rowZ, w: .12, d: 1.8 },
      { name: 'table tennis table', x: room.tableX, z: room.rowZ, w: GAMES.table.length, d: GAMES.table.width },
      { name: 'chess table', x: room.chessX, z: room.rowZ, w: GAMES.chessTable.size, d: GAMES.chessTable.size },
      ...[-1, 1].map(side => ({ name: 'chess chair', x: room.chessX + side * GAMES.chessSeat, z: room.rowZ, w: .78, d: .78 })),
      { name: 'nap couch', x: napCouch(layout).x, z: napCouch(layout).z, w: NAP_COUCH.length, d: NAP_COUCH.depth },
      ...Object.entries(petGeometry(layout).beds).map(([kind, [x, z]]) => ({ name: `${kind} bed`, x, z, w: kind === 'dog' ? 1.4 : .8, d: 1.1 })),
    )
    const [eastPlayer] = pingPongSpots(layout).map(spot => spot.point).slice(-1)
    assert.ok(room.chessX - GAMES.chessSeat - .39 - eastPlayer[0] > .45, `table tennis player too close to the chess chairs (${count}/${spacing})`)
    // The games room fits inside the floor, clear of the last row of desks and of the corridor.
    assert.ok(room.z > Math.max(...layout.seats.map(seat => seat.position[2])) + 2, `games room overlaps desks (${count}/${spacing})`)
    assert.ok(room.chessX + GAMES.chessSeat + .5 < layout.width && room.tableX - GAMES.table.length / 2 - GAMES.playerGap > layout.spineX + .7, `games furniture does not fit (${count}/${spacing})`)
    const players = [...dartsSpots(layout), ...pingPongSpots(layout), ...chessSeats(layout)].map(spot => spot.point)
    for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) assert.ok(Math.hypot(players[i][0] - players[j][0], players[i][1] - players[j][1]) > 1.2)
    layout.seats.forEach((seat, ordinal) => {
      for (const route of planForSeat(layout, seat, ordinal).excursions.filter(item => item.activity !== 'coffee')) {
        for (let segment = 0; segment < route.points.length - 1; segment++) {
          const [ax, az] = route.points[segment], [bx, bz] = route.points[segment + 1]
          for (let sample = 0; sample <= 24; sample++) {
            const t = sample / 24, px = ax + (bx - ax) * t, pz = az + (bz - az) * t
            assert.ok(px > .2 && px < layout.width - .2 && pz > .2 && pz < layout.depth - .2, `${route.spot} leaves the floor (${count}/${spacing})`)
            // Walking bodies keep ~.3 m clear of furniture.
            // The stand point right in front of a sofa seat is meant to be close to the sofa, never inside it.
            const stand = route.points[route.breakIndex]
            const margin = Math.hypot(px - stand[0], pz - stand[1]) < .5 ? 0 : .3
            // Like desk chairs, the rolling chess chairs may be brushed while stepping in front of them.
            for (const b of blockers) if (!(route.activity === 'chess' && b.name === 'chess chair')) assert.ok(!(Math.abs(px - b.x) < b.w / 2 + margin && Math.abs(pz - b.z) < b.d / 2 + margin), `${route.spot} walks through the ${b.name} (${count}/${spacing})`)
            for (const other of layout.seats) {
              const dx = Math.abs(px - other.position[0]), dz = pz - other.position[2]
              assert.ok(!(dx < 1.35 && dz > -.98 && dz < .55), `desk collision on ${route.spot} at ${count}/${spacing}`)
              assert.ok(!(dx < .55 && dz > .65 && dz < 1.67), `chair collision on ${route.spot} at ${count}/${spacing}`)
            }
          }
        }
      }
    })
    // Seats are far enough apart for two seated agents, and board spots for two readers.
    const [a, b] = tvSeats(layout).map(spot => spot.point)
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= .72)
    const [c, d] = boardSpots(layout).map(spot => spot.point)
    assert.ok(Math.hypot(c[0] - d[0], c[1] - d[1]) >= 1.2)
  }
})

test('idle poses keep limbs connected at natural lengths', () => {
  const length = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const poses = [[1, 'browse'], [1, 'lap'], [0, 'stretch'], [0, 'phone'], [0, 'look'], [0, 'darts'], [0, 'pingpong'], [1, 'chess'], [0, 'sleep'], [0, 'pet']]
  // Every blend amount and moment of the stretch cycle, not only the finished poses.
  for (const [seated, name] of poses) for (const amount of [.15, .35, .5, .75, 1]) for (const t of [0, .4, .9, 1.3, 1.8, 2.5, 3.2, 4.1]) {
    const idle = { [name]: amount }
    {
      const rig = makeAvatarRigPose(seated, false, t, 'idle', 0, 0, 0, 0, idle)
      for (const arm of rig.arms) {
        // Same range as the existing working poses (seated upper arm .54, standing forearm .28).
        assert.ok(length(arm.shoulder, arm.elbow) > .28 && length(arm.shoulder, arm.elbow) < .56, `upper arm stretched in ${JSON.stringify(idle)}`)
        // Chess pondering reuses the task 'thinking' hand-to-chin pose, whose forearm reaches .61.
        assert.ok(length(arm.elbow, arm.wrist) > .25 && length(arm.elbow, arm.wrist) < (name === 'chess' ? .62 : .46), `forearm stretched in ${JSON.stringify(idle)}`)
      }
    }
  }
  const stretched = makeAvatarRigPose(0, false, Math.PI / 1.25, 'idle', 0, 0, 0, 0, { stretch: 1 })
  assert.ok(stretched.arms.every(arm => arm.wrist[1] > 2.2), 'stretching raises both hands overhead')
  const lounging = makeAvatarRigPose(1, false, 0, 'idle', 0, 0, 0, 0, { lap: 1 })
  assert.ok(lounging.arms.every(arm => arm.wrist[1] < 1), 'on the sofa the hands rest on the lap')
})

test('agent editing rejects malformed input and malicious values', () => {
  assert.equal(validateAgent({ name: 'test', role: 'dev', specialty: 'code', color: '#abcdef', department: 'engineering' }), null)
  assert.ok(validateAgent({ name: '<script>\n', role: 'dev', specialty: 'code', color: '#abcdef', department: 'engineering' }))
  assert.ok(validateAgent({ name: 'ok', role: 'dev', specialty: 'code', color: 'red', department: 'engineering' }))
  assert.ok(validateAgent({ name: 'ok', role: 'dev', specialty: 'code', color: '#abcdef', department: 'admin' }))
})

test('geometry rebuilds are distinct from metadata snapshots and restore actual work poses', () => {
  const original = makeOfficeLayout(DEFAULT_AGENTS)
  const metadata = makeOfficeLayout(DEFAULT_AGENTS.map(agent => ({ ...agent, name: agent.name + ' updated', color: '#123456' })))
  assert.equal(layoutGeometryKey(metadata), layoutGeometryKey(original), 'profile-only updates must not rebuild the office')
  const changed = makeOfficeLayout(DEFAULT_AGENTS, 'spacious')
  assert.notEqual(layoutGeometryKey(changed), layoutGeometryKey(original))
  const latest = makeOfficeLayout(DEFAULT_AGENTS, 'compact')
  assert.notEqual(layoutGeometryKey(latest), layoutGeometryKey(changed))
  const actors = reconcileOfficeSimulation(original)
  const held = reconcileOfficeSimulation(changed, actors)
  for (const [id, actor] of actors) assert.equal(held.get(id).state, actor.state, 'the old scene stays intact until the transition completes')
  const rebuilt = reconcileOfficeSimulation(latest, new Map(), new Set(['nova']))
  assert.equal(rebuilt.get('nova').state.stage, 'working')
  assert.equal(rebuilt.get('nova').state.seated, 1)
  const seat = latest.seats.find(item => item.agent.id === 'nova')
  assert.deepEqual(rebuilt.get('nova').state.position, [seat.position[0], seat.position[2] + CHAIR_Z])
})

test('distant actors finish tasks and chair transitions even after focus changes', () => {
  const team = makeTeam(100), layout = makeOfficeLayout(team)
  const simulation = reconcileOfficeSimulation(layout)
  const hidden = layout.seats.at(-1).agent.id
  const visible = new Set(layout.seats.slice(0, 50).map(seat => seat.agent.id))
  for (let i = 0; i < 200; i++) stepOfficeSimulation(simulation, visible, new Set([hidden]), .05, 'off')
  assert.equal(simulation.get(hidden).state.stage, 'working', 'a hidden active agent must actually approach and sit')
  const state = simulation.get(hidden).state
  stepOfficeSimulation(simulation, new Set([hidden]), new Set([hidden]), .05, 'off')
  assert.deepEqual(simulation.get(hidden).state.position, state.position, 'changing detail selection must preserve location')
  for (let i = 0; i < 200; i++) stepOfficeSimulation(simulation, visible, new Set(), .05, 'off')
  assert.equal(simulation.get(hidden).state.stage, 'standing', 'hidden agents must rise after work ends')
})

test('the schedule board stands clear of every walking route, the reception desk and the meeting lounge', async () => {
  const { scheduleBoardPosition } = await import('../src/scene/scheduleBoardLayout.ts')
  const segmentDistance = ([ax, az], [bx, bz], [px, pz]) => {
    const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz
    const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length)) : 0
    return Math.hypot(ax + t * dx - px, az + t * dz - pz)
  }
  for (const count of [0, 1, 3, 4, 7, 20, 60]) for (const spacing of ['compact', 'regular', 'spacious']) {
    const layout = makeOfficeLayout(makeTeam(count), spacing)
    const [x, , z] = scheduleBoardPosition(layout)
    const reception = layout.amenities.find(item => item.id === 'reception')
    assert.ok(x > .1 && x < layout.spineX - 2.5, `board inside the service wing (${count}, ${spacing})`)
    // Board footprint reaches ~.85 m from its centre; the desk front edge sits .48 m ahead of its centre.
    assert.ok(z - .8 > reception.z + .48, `board clear of the reception desk (${count}, ${spacing})`)
    for (const lounge of layout.amenities.filter(item => item.id !== 'reception')) {
      assert.ok(Math.hypot(lounge.x - x, lounge.z - z) > 2.15 + .9, `board clear of ${lounge.key} (${count}, ${spacing})`)
    }
    layout.seats.forEach((seat, ordinal) => {
      const { route } = routeForSeat(layout, seat, ordinal)
      for (let i = 1; i < route.points.length; i++) {
        assert.ok(segmentDistance(route.points[i - 1], route.points[i], [x, z]) > 1.2, `route of ${seat.agent.id} passes the board (${count}, ${spacing})`)
      }
    })
  }
})

test('reception desk clock and wall calendar sit on their furniture without intersecting other props', async () => {
  const { DESK_CLOCK, WALL_CALENDAR, RECEPTION_PROPS, clockText, calendarText } = await import('../src/scene/timepieceLayout.ts')
  const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 - .001 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 - .001 && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 - .001
  // The clock is rotated; use its rotated footprint as an axis-aligned bound.
  const turn = Math.abs(DESK_CLOCK.rotationY)
  const clock = { ...DESK_CLOCK, width: DESK_CLOCK.width * Math.cos(turn) + DESK_CLOCK.depth * Math.sin(turn), depth: DESK_CLOCK.width * Math.sin(turn) + DESK_CLOCK.depth * Math.cos(turn) }
  const top = RECEPTION_PROPS.counterTop
  assert.ok(Math.abs(clock.y - clock.height / 2 - (top.y + top.height / 2)) < .02, 'clock rests on the counter top')
  assert.ok(Math.abs(clock.x) + clock.width / 2 <= top.width / 2 && Math.abs(clock.z) + clock.depth / 2 <= top.depth / 2, 'clock stays on the counter')
  for (const [name, prop] of Object.entries(RECEPTION_PROPS)) {
    if (name !== 'counterTop') assert.ok(!overlaps(clock, prop), `clock intersects ${name}`)
    if (name !== 'backWall') assert.ok(!overlaps(WALL_CALENDAR, prop), `calendar intersects ${name}`)
  }
  const wall = RECEPTION_PROPS.backWall
  assert.ok(Math.abs(WALL_CALENDAR.z - WALL_CALENDAR.depth / 2 - (wall.z + wall.depth / 2)) < .002, 'calendar hangs flush on the wall face')
  assert.ok(WALL_CALENDAR.y + WALL_CALENDAR.height / 2 < wall.y + wall.height / 2 && Math.abs(WALL_CALENDAR.x) + WALL_CALENDAR.width / 2 < wall.width / 2, 'calendar fits on the wall')
  assert.equal(clockText(new Date(2030, 0, 7, 9, 5)), '09:05')
  assert.deepEqual(calendarText(new Date(2030, 0, 7)), { month: 'JANUARY', day: '7', weekday: 'Monday' })
})

test('knowledge graph pedestal stands clear of reception, the corridor, desks and every walking route', () => {
  for (const count of [1, 3, 4, 20, 60]) for (const spacing of ['compact', 'regular', 'spacious']) {
    const layout = makeOfficeLayout(makeTeam(count), spacing)
    const [x, , z] = knowledgeGraphPosition(layout)
    const reception = layout.amenities.find(item => item.id === 'reception')
    const clear = KNOWLEDGE_RADIUS + .3
    assert.ok(x - KNOWLEDGE_RADIUS > reception.x + RECEPTION_PROPS.counterTop.width / 2 + .3, `pedestal touches the reception counter (${count}/${spacing})`)
    assert.ok(z - KNOWLEDGE_RADIUS > reception.z + RECEPTION_PROPS.backWall.z + RECEPTION_PROPS.backWall.depth / 2, `pedestal is hidden behind the reception wall (${count}/${spacing})`)
    assert.ok(layout.spineX - x > clear + .5, `pedestal crowds the central corridor (${count}/${spacing})`)
    for (const seat of layout.seats) assert.ok(Math.hypot(seat.position[0] - x, seat.position[2] - z) > 3, 'pedestal is inside a team bay')
    layout.seats.forEach((seat, ordinal) => {
      for (const route of [routeFor(layout, seat, ordinal), ...planForSeat(layout, seat, ordinal).excursions]) {
        for (let segment = 0; segment < route.points.length - 1; segment++) {
          const [ax, az] = route.points[segment], [bx, bz] = route.points[segment + 1]
          for (let sample = 0; sample <= 24; sample++) {
            const t = sample / 24
            assert.ok(Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z) > clear, `${route.spot || 'desk'} route walks through the knowledge graph (${count}/${spacing})`)
          }
        }
      }
    })
  }
})

test('knowledge graph lights up only for running tasks that recently queried graphify', () => {
  for (const message of ['Claude used mcp__graphify__query_graph.', 'Antigravity used query_graph.', 'Starting graphify tool: graphify_find', 'Antigravity used graphify__graph_stats.'])
    assert.equal(isKnowledgeEvent(message), true, message)
  for (const message of ['Claude used Grep.', 'Antigravity used search.', 'Agent replied: I used graphify tool: query_graph.', 'Claude replied: Claude used graphify.', 'Starting command: rg graphify'])
    assert.equal(isKnowledgeEvent(message), false, message)
  const now = Date.parse('2026-11-10T12:00:00Z')
  const at = offset => new Date(now - offset).toISOString()
  const event = (message, offset) => ({ id: message, at: at(offset), kind: 'info', message })
  const tasks = [
    { agentId: 'atlas', status: 'running', events: [event('Claude used mcp__graphify__search.', 5_000), event('Claude used Edit.', 1_000)] },
    { agentId: 'nova', status: 'running', events: [event('Antigravity used query_graph.', KNOWLEDGE_RECENT_MS + 1_000)] },
    { agentId: 'orbit', status: 'completed', events: [event('Claude used mcp__graphify__search.', 500)] },
    { agentId: 'pixel', status: 'running', events: [event('Claude used Read.', 100)] },
  ]
  const readers = knowledgeReaders(tasks)
  assert.deepEqual(readers.map(reader => reader.agentId), ['atlas', 'nova'])
  assert.deepEqual(activeReaders(readers, now).map(reader => reader.agentId), ['atlas'])
  const { nodes, edges } = knowledgeGeometry()
  assert.equal(nodes.length, 18)
  assert.ok(nodes.every(node => Math.hypot(...node) <= HOLOGRAM_RADIUS + 1e-9), 'nodes stay inside the hologram radius')
  assert.ok(edges.length >= nodes.length && edges.every(([a, b]) => a < b && b < nodes.length))
})

test('work poses only show once the agent is seated at its own desk', () => {
  for (const pose of WORK_POSES) {
    assert.equal(presentedPose(pose, false), 'idle', `${pose} must not show away from the desk`)
    assert.equal(presentedPose(pose, true), pose)
  }
  // Results of a finished task are shown wherever the agent is.
  for (const pose of ['celebrating', 'error', 'idle']) assert.equal(presentedPose(pose, false), pose)
})

test('an agent away from the desk walks back and sits before it is shown working', () => {
  for (const motion of ['lively', 'subtle', 'off']) {
    const layout = makeOfficeLayout(DEFAULT_AGENTS)
    const ids = new Set(layout.seats.map(seat => seat.agent.id))
    const simulation = reconcileOfficeSimulation(layout)
    // Let the floor play (always lively) until someone is away from the desk on a visit.
    const away = () => [...simulation].find(([, actor]) => actor.state.excursion >= 0 && ['coffee', 'viewing', 'lounging'].includes(actor.state.stage))
    for (let i = 0; i < 24000 && !away(); i++) stepOfficeSimulation(simulation, ids, new Set(), .05, 'lively')
    const [id, actor] = away() ?? []
    assert.ok(id, 'an agent should leave the desk for a visit')
    const start = [...actor.state.position]
    const seat = layout.seats.find(item => item.agent.id === id)
    const stages = []
    let shownAwayFromDesk = 0
    for (let i = 0; i < 4000; i++) {
      stepOfficeSimulation(simulation, ids, new Set([id]), .05, motion)
      const state = simulation.get(id).state
      stages.push(state.stage)
      const atDesk = state.stage === 'working'
      if (presentedPose('coding', atDesk) !== 'idle' && state.seated < 1) shownAwayFromDesk++
      if (atDesk) break
    }
    const state = simulation.get(id).state
    assert.equal(state.stage, 'working', `${motion}: the agent must reach the desk (stages: ${[...new Set(stages)]})`)
    assert.equal(state.seated, 1, `${motion}: working means fully seated`)
    assert.ok(Math.hypot(state.position[0] - seat.position[0], state.position[1] - (seat.position[2] + CHAIR_Z)) < 1e-6, `${motion}: seated in the agent's own chair`)
    assert.equal(shownAwayFromDesk, 0, `${motion}: work was shown before sitting down`)
    if (motion !== 'off') {
      assert.ok(stages.includes('returning') && stages.includes('sitting'), `${motion}: walks back and sits down (stages: ${[...new Set(stages)]})`)
      assert.ok(Math.hypot(start[0] - state.position[0], start[1] - state.position[1]) > 2, `${motion}: the visit was away from the desk`)
    }
  }
})

/** Furniture in the service wing and games room, as footprints, for the nap couch and pet checks. */
function wingFurniture(layout) {
  const room = gamesRoom(layout), couch = napCouch(layout), lounge = layout.amenities.find(item => item.id === 'meeting')
  return [
    ...(lounge ? [{ name: 'sofa', x: lounge.x + SOFA.offsetX + .02, z: lounge.z, w: SOFA.depth + .08, d: SOFA.length + .3 },
      { name: 'coffee table', x: lounge.x + COFFEE_TABLE.offsetX, z: lounge.z, w: COFFEE_TABLE.width, d: COFFEE_TABLE.depth }] : []),
    { name: 'dart partition', x: room.dartsBoardX - .06, z: room.rowZ, w: .12, d: 1.8 },
    { name: 'table tennis table', x: room.tableX, z: room.rowZ, w: GAMES.table.length, d: GAMES.table.width },
    { name: 'chess table', x: room.chessX, z: room.rowZ, w: GAMES.chessTable.size, d: GAMES.chessTable.size },
    ...[-1, 1].map(side => ({ name: 'chess chair', x: room.chessX + side * GAMES.chessSeat, z: room.rowZ, w: .78, d: .78 })),
    { name: 'nap couch', x: couch.x, z: couch.z, w: NAP_COUCH.length, d: NAP_COUCH.depth },
    { name: 'west planter', x: .65, z: layout.depth - .65, w: .7, d: .7 }, { name: 'east planter', x: layout.width - .65, z: layout.depth - .65, w: .7, d: .7 },
  ]
}
const inside = (px, pz, b, margin) => Math.abs(px - b.x) < b.w / 2 + margin && Math.abs(pz - b.z) < b.d / 2 + margin
function samples(points, each) {
  for (let i = 0; i < points.length - 1; i++) for (let k = 0; k <= 24; k++) {
    const t = k / 24
    each(points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t)
  }
}

test('nap couch and pet beds fit the games room clear of its games, players and the corridor', () => {
  for (const count of [1, 3, 4, 20, 60]) for (const spacing of ['compact', 'regular', 'spacious']) {
    const layout = makeOfficeLayout(makeTeam(count), spacing)
    const room = gamesRoom(layout), couch = napCouch(layout), pets = petGeometry(layout)
    const where = `(${count}/${spacing})`
    // Inside the floor and the games room's south strip, west of the corridor.
    assert.ok(couch.x - NAP_COUCH.length / 2 > .65 + .35 + .3 && couch.x + NAP_COUCH.length / 2 < layout.spineX - 1.1 - .3, `nap couch crowds the corridor or the west wall ${where}`)
    assert.ok(couch.z + NAP_COUCH.depth / 2 < layout.depth - .2 && couch.z - NAP_COUCH.depth / 2 > room.rowZ + 1.7, `nap couch leaves the south strip ${where}`)
    const players = [...dartsSpots(layout), ...pingPongSpots(layout), ...chessSeats(layout)].map(spot => spot.point)
    const games = wingFurniture(layout).filter(item => !['nap couch', 'sofa', 'coffee table'].includes(item.name))
    for (const b of [{ x: couch.x, z: couch.z, w: NAP_COUCH.length, d: NAP_COUCH.depth }, ...Object.values(pets.beds).map(([x, z]) => ({ x, z, w: 1.1, d: 1.1 }))]) {
      for (const other of games) assert.ok(!(Math.abs(b.x - other.x) < (b.w + other.w) / 2 + .3 && Math.abs(b.z - other.z) < (b.d + other.d) / 2 + .3), `${other.name} too close to the nap couch or a pet bed ${where}`)
      for (const [px, pz] of players) assert.ok(!inside(px, pz, b, .6), `a player stands in the nap couch or a pet bed ${where}`)
    }
    for (const [x] of Object.values(pets.beds)) assert.ok(x - .55 > layout.spineX + 1.1 && x + .55 < layout.width - 1.1, `pet bed outside the east strip ${where}`)
    // The lying body (shoes to crown, 2.25 m) stays between the armrests.
    const [spot] = napSpots(layout)
    const inner = NAP_COUCH.length / 2 - NAP_COUCH.armrest
    assert.ok(spot.point[0] + .14 < couch.x + inner && spot.point[0] - 2.25 > couch.x - inner - .03, `the napping body does not fit the couch ${where}`)
  }
})

test('pet paths stay on walkways: clear of desks, chairs and service-wing furniture', () => {
  for (const count of [1, 3, 4, 20, 60]) for (const spacing of ['compact', 'regular', 'spacious']) {
    const layout = makeOfficeLayout(makeTeam(count), spacing)
    const simulation = reconcileOfficeSimulation(layout)
    const pets = createOfficePets(layout)
    const furniture = wingFurniture(layout)
    const where = `(${count}/${spacing})`
    const check = (points, label) => samples(points, (px, pz) => {
      assert.ok(px > .2 && px < layout.width - .2 && pz > .2 && pz < layout.depth - .2, `${label} leaves the floor ${where}`)
      for (const b of furniture) assert.ok(!inside(px, pz, b, .2), `${label} walks through the ${b.name} ${where}`)
      for (const other of layout.seats) {
        const dx = Math.abs(px - other.position[0]), dz = pz - other.position[2]
        assert.ok(!(dx < 1.35 && dz > -.98 && dz < .55), `${label} walks through a desk ${where}`)
        assert.ok(!(dx < .55 && dz > .65 && dz < 1.67), `${label} walks through a chair ${where}`)
      }
    })
    for (const pet of pets) {
      for (const seat of layout.seats) check(pathToAgent(layout, simulation, pet, seat.agent.id), `${pet.kind} → ${seat.agent.id}`)
      check(pathToNap(layout, pet), `${pet.kind} → nap couch`)
    }
    // A visiting pet waits beside the agent, close enough to pet but not in its personal space.
    const home = simulation.get(layout.seats[0].agent.id).plan.home
    const distance = Math.hypot(...GREET_OFFSET)
    assert.ok(distance > .6 && distance < .75, 'greet point should be within reach of the agent')
    assert.ok(home, 'agent home exists')
  }
})

test('agents nap on the couch, and a task wakes them and sends them back to the desk', () => {
  const layout = makeOfficeLayout(DEFAULT_AGENTS)
  const ids = new Set(layout.seats.map(seat => seat.agent.id))
  const simulation = reconcileOfficeSimulation(layout)
  let sleeper = null, napped = 0
  for (let i = 0; i < 36000 && !sleeper; i++) {
    stepOfficeSimulation(simulation, ids, new Set(), .05, 'lively')
    const asleep = [...simulation].filter(([, actor]) => isSleeping(actor))
    assert.ok(asleep.length <= 1, 'the nap couch holds one agent at a time')
    if (asleep.length && ++napped > 200) sleeper = asleep[0][0]
  }
  assert.ok(sleeper, 'idle agents should take naps')
  const [spot] = napSpots(layout)
  assert.deepEqual(simulation.get(sleeper).state.position, spot.point, 'the napping agent lies on the couch')
  for (let i = 0; i < 4000 && simulation.get(sleeper).state.stage !== 'working'; i++) stepOfficeSimulation(simulation, ids, new Set([sleeper]), .05, 'lively')
  assert.equal(simulation.get(sleeper).state.stage, 'working', 'a task wakes the napping agent and sends it to work')
})

test('pets visit agents, get petted, keep a napping agent company and rest in bed with motion off', () => {
  const layout = makeOfficeLayout(DEFAULT_AGENTS)
  const ids = new Set(layout.seats.map(seat => seat.agent.id))
  const simulation = reconcileOfficeSimulation(layout)
  const pets = createOfficePets(layout)
  assert.deepEqual(pets.map(pet => pet.kind), ['dog', 'cat'])
  const seen = new Set()
  let petted = 0, catNap = 0, closest = Infinity
  for (let i = 0; i < 36000; i++) {
    const visits = petVisits(pets)
    stepOfficeSimulation(simulation, ids, new Set(), .05, 'lively', visits)
    for (const [id, actor] of simulation) if (actor.state.activity === 'pet' && actor.state.stage === 'idling') {
      assert.ok(visits.has(id), 'agents only pet a pet that came to them')
    }
    stepOfficePets(pets, layout, simulation, ids, .05, 'lively')
    for (const pet of pets) {
      seen.add(`${pet.kind}:${pet.stage}`)
      if (pet.stage === 'visiting') {
        const actor = simulation.get(pet.target)
        // The pet waits beside its agent.
        const [hx, hz] = actor.plan.home
        assert.ok(Math.hypot(pet.position[0] - hx - GREET_OFFSET[0], pet.position[1] - hz - GREET_OFFSET[1]) < 1e-6, 'visiting pet is beside the agent')
        if (actor.state.stage === 'idling' && actor.state.activity === 'pet') { petted++; assert.equal(actor.state.facing, PET_FACING, 'the agent turns toward the pet') }
      }
      if (pet.kind === 'cat' && pet.stage === 'napping') { catNap++; assert.ok(isSleeping(simulation.get(pet.target)), 'the cat only naps beside a sleeping agent') }
    }
    const apart = Math.hypot(pets[0].position[0] - pets[1].position[0], pets[0].position[1] - pets[1].position[1])
    assert.ok(apart >= .62 - 1e-6 || apart >= closest, `pets do not walk into each other (${apart.toFixed(2)} m)`)
    closest = apart
  }
  for (const state of ['dog:walking', 'dog:visiting', 'dog:resting', 'cat:walking', 'cat:visiting', 'cat:napping']) assert.ok(seen.has(state), `${state} should happen`)
  assert.ok(petted > 0, 'an idle agent pets a visiting pet')
  assert.ok(catNap > 0, 'the cat curls up beside a napping agent')
  // Reduced motion: pets rest in their beds.
  stepOfficePets(pets, layout, simulation, ids, .05, 'off')
  for (const pet of pets) { assert.equal(pet.stage, 'resting'); assert.deepEqual(pet.position, pet.bed) }
  assert.deepEqual(Object.keys(PET_BEDS), ['dog', 'cat'])
})
