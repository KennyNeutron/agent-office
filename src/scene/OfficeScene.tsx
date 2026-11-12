import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, OrthographicCamera, RoundedBox } from '@react-three/drei'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Group, Mesh } from 'three'
import { MathUtils, Vector3 } from 'three'
import { CalendarClock, Moon, Network } from 'lucide-react'
import { type AgentId, type OfficeSchedule, type OfficeTask } from '../types'
import { DEPARTMENTS, useAgents } from '../agents'
import { OfficeCampus } from './OfficeCampus'
import { OfficeAvatar } from './OfficeAvatar'
import { OfficeCrowdLOD } from './OfficeCrowdLOD'
import { makeOfficeLayout, type OfficeLayout, type Seat } from './officeLayout'
import { CHAIR_Z, STAND_Z } from './officeMotion'
import { layoutGeometryKey, reconcileOfficeSimulation, stepOfficeSimulation, type OfficeSimulation } from './officeSimulation'
import { createOfficePets, petVisits, stepOfficePets, type OfficePets } from './petSimulation'
import { OfficePetsView } from './OfficePets'
import { useOfficePreferences } from './OfficePreferencesContext'
import type { OfficePreferences } from './officePreferences'
import { useLanguage } from '../locales/i18n'
import { phaseName, statusName } from '../components/taskDisplay'
import { ScheduleBoard } from './ScheduleBoard'
import { LoungeTV } from './LoungeTV'
import { GamesRoom, PingPongBall } from './GamesRoom'
import { BOARD_LABEL_HEIGHT, scheduleBoardPosition } from './scheduleBoardLayout'
import { KnowledgeGraph } from './KnowledgeGraph'
import { useKnowledgeReaders } from './useKnowledgeReaders'
import { KNOWLEDGE_LABEL, knowledgeGraphPosition, type KnowledgeReader } from './knowledgeGraphLayout'
import type { IdlePose } from './avatarRig'
import { idleStatus, resolveAgentPose, selectAgentTask, TERMINAL_POSE_MS, type AgentPose } from './agentBehavior'

// Project world positions to the existing React DOM layer without creating
// separate React roots inside Three.js (which can race during unmount).
function BadgeProjector({ overlayId, seats, sectors, avatars, board, knowledge, translate }: { translate: (text: string) => string; overlayId: string; seats: Seat[]; sectors: OfficeLayout['sectors']; avatars: RefObject<Map<string, Group>>; board: [number, number, number]; knowledge: [number, number, number] }) {
  const point = useRef(new Vector3())
  const labels = useRef<Map<string, HTMLSpanElement>>(new Map())
  useEffect(() => {
    const overlay = document.getElementById(overlayId)
    const entries = overlay?.querySelectorAll<HTMLSpanElement>('[data-agent], [data-sector], [data-board]') || []
    labels.current = new Map([...entries].map(node => [node.dataset.agent || (node.dataset.board ? `board:${node.dataset.board}` : `sector:${node.dataset.sector}`), node]))
    return () => { labels.current.clear() }
  }, [overlayId, seats, sectors])
  useFrame(({ camera, size }) => {
    const place = (id: string, x: number, y: number, z: number) => {
      const label = labels.current.get(id)
      if (!label) return
      point.current.set(x, y, z).project(camera)
      label.style.left = `${(point.current.x + 1) * size.width / 2}px`
      label.style.top = `${(1 - point.current.y) * size.height / 2}px`
      label.style.visibility = Math.abs(point.current.x) > 1 || Math.abs(point.current.y) > 1 || point.current.z > 1 ? 'hidden' : 'visible'
    }
    for (const seat of seats) {
      const avatar = avatars.current.get(seat.agent.id)
      if (avatar) {
        const label = labels.current.get(seat.agent.id)
        if (label) {
          label.dataset.movementStage = String(avatar.userData.movementStage || 'standing')
          label.dataset.walking = String(Boolean(avatar.userData.walking))
          label.dataset.coffeeBreak = String(Boolean(avatar.userData.coffeeBreak))
          label.dataset.idleActivity = String(avatar.userData.idleActivity || '')
          // Recorded every frame, independent of the task pose React renders, so a new
          // task never shows work before the avatar is seated (see index.css).
          label.dataset.atDesk = String(Boolean(avatar.userData.atDesk))
          label.dataset.sleeping = String(Boolean(avatar.userData.sleeping))
          // What an agent without work is doing; written only when it changes.
          const status = label.querySelector<HTMLSpanElement>('.label-idle'), text = translate(String(avatar.userData.idleStatus || 'Idle'))
          if (status && status.textContent !== text) status.textContent = text
        }
        avatar.getWorldPosition(point.current)
        if (label) {
          label.dataset.worldX = point.current.x.toFixed(3)
          label.dataset.worldZ = point.current.z.toFixed(3)
        }
        // A napping agent lies along its local -Z: label the middle of the body, just above it, not the feet.
        if (avatar.userData.sleeping) { point.current.set(0, 1.45, -1.15); avatar.localToWorld(point.current); place(seat.agent.id, point.current.x, point.current.y, point.current.z) }
        else place(seat.agent.id, point.current.x, point.current.y + 2.28, point.current.z)
      }
    }
    for (const sector of sectors) place(`sector:${sector.key}`, sector.center[0], 3.9, sector.center[2] - sector.depth / 2 + .3)
    place('board:schedule', board[0], BOARD_LABEL_HEIGHT, board[2])
    place('board:knowledge', knowledge[0] + KNOWLEDGE_LABEL.dx, KNOWLEDGE_LABEL.y, knowledge[2] + KNOWLEDGE_LABEL.dz)
  })
  return null
}

function FollowSelected({ selected, overview, avatars, center }: { selected: string; overview: boolean; avatars: RefObject<Map<string, Group>>; center: [number, number, number] }) {
  const previous = useRef<Vector3 | null>(null)
  const tracked = useRef('')
  const world = useRef(new Vector3())
  useFrame(({ camera, controls }) => {
    if (overview) { previous.current = null; tracked.current = ''; return }
    const avatar = avatars.current.get(selected)
    const orbit = controls as unknown as { target: Vector3; update: () => void } | undefined
    if (!avatar || !orbit) return
    avatar.getWorldPosition(world.current)
    if (tracked.current !== selected || !previous.current) {
      tracked.current = selected
      previous.current = new Vector3(center[0], 0, center[2])
    }
    const dx = world.current.x - previous.current.x, dz = world.current.z - previous.current.z
    camera.position.x += dx; camera.position.z += dz
    orbit.target.x += dx; orbit.target.z += dz
    previous.current.copy(world.current)
    orbit.update()
  }, -.5)
  return null
}

function Desk({ color, screen, workingRef, theme }: { color: string; /** The agent's own colour: screen glow and mug. */ screen: string; workingRef: RefObject<boolean>; theme: OfficePreferences['theme'] }) {
  const monitor = useRef<Mesh>(null)
  useFrame(state => {
    // The screen lights up for a task only once its agent is seated at it.
    if (monitor.current) (monitor.current.material as { emissiveIntensity?: number }).emissiveIntensity = workingRef.current ? .33 + Math.sin(state.clock.elapsedTime * 2.7) * .14 : .08
  })
  return <group>
    {/* One workstation is a complete, grounded furniture cluster. The low
        carpet defines each desk without blocking a neighbouring aisle. */}
    <mesh position={[0, .003, .23]} receiveShadow>
      <boxGeometry args={[2.96, .006, 2.83]}/>
      <meshStandardMaterial color={theme === 'midnight' ? '#405264' : theme === 'warm' ? '#dfd2c6' : '#cedce7'} roughness={1}/>
    </mesh>
    <mesh position={[0, .008, 1.57]}>
      <boxGeometry args={[2.85, .008, .055]}/><meshStandardMaterial color={color} roughness={.93}/>
    </mesh>
    {/* Chair faces the near edge of the desk, with the backrest behind the worker. */}
    <RoundedBox position={[0, .65, CHAIR_Z]} args={[.82, .13, .83]} radius={.12} castShadow><meshStandardMaterial color="#4b6079" roughness={.78}/></RoundedBox>
    <RoundedBox position={[0, 1.05, CHAIR_Z + .43]} args={[.87, .76, .13]} radius={.12} castShadow><meshStandardMaterial color="#536c89" roughness={.82}/></RoundedBox>
    <mesh position={[0, .34, CHAIR_Z]}><cylinderGeometry args={[.07, .09, .57, 10]}/><meshStandardMaterial color="#58667b" metalness={.4}/></mesh>
    <mesh position={[0, .1, CHAIR_Z]}><boxGeometry args={[1.02, .08, .12]}/><meshStandardMaterial color="#39465d"/></mesh>
    <mesh position={[0, .1, CHAIR_Z]}><boxGeometry args={[.12, .08, .94]}/><meshStandardMaterial color="#39465d"/></mesh>
    {[-1, 1].map(side => <group key={`chair-arm-${side}`} position={[side * .49, 0, CHAIR_Z]}>
      <mesh position={[0, .76, -.03]}><boxGeometry args={[.07, .23, .07]}/><meshStandardMaterial color="#4d6075"/></mesh>
      <RoundedBox position={[0, .88, -.07]} args={[.11, .065, .46]} radius={.026}><meshStandardMaterial color="#364658"/></RoundedBox>
    </group>)}
    {[0, 1, 2, 3].map(i => <mesh key={`caster-${i}`} position={[Math.cos(i * Math.PI / 2) * .45, .085, CHAIR_Z + Math.sin(i * Math.PI / 2) * .45]} rotation={[0, Math.PI / 2 * i, Math.PI / 2]}>
      <cylinderGeometry args={[.085, .085, .095, 12]}/><meshStandardMaterial color="#303c50"/></mesh>)}
    <RoundedBox position={[0, .95, -.22]} args={[2.5, .16, 1.32]} radius={.065} castShadow receiveShadow><meshStandardMaterial color={theme === 'midnight' ? '#a48b78' : theme === 'warm' ? '#d6b79b' : '#e5eaf0'} roughness={.72} /></RoundedBox>
    <mesh position={[0, .855, .425]}><boxGeometry args={[2.37, .022, .038]}/><meshStandardMaterial color={color} roughness={.83}/></mesh>
    {[-1.04, 1.04].map(x => [-.66, .25].map(z => <mesh key={`${x}-${z}`} position={[x, .48, z]} castShadow>
      <boxGeometry args={[.09, .92, .09]} /><meshStandardMaterial color="#556079" metalness={.45} />
    </mesh>))}
    {/* Side storage, pinned notes, pen cup and a closed notebook keep the desk
        recognizable as a lived-in work surface. All items rest on furniture. */}
    <RoundedBox position={[-.91, .59, -.19]} args={[.40, .53, .49]} radius={.027} castShadow>
      <meshStandardMaterial color={theme === 'midnight' ? '#495569' : '#acbdc9'} roughness={.8}/>
    </RoundedBox>
    {[.48, .65].map(y => <group key={y} position={[-.91, y, .062]}>
      <mesh><boxGeometry args={[.3, .12, .012]}/><meshStandardMaterial color="#e3e9ed"/></mesh>
      <mesh position={[0, 0, .011]}><boxGeometry args={[.085, .012, .018]}/><meshStandardMaterial color="#6d7b8b"/></mesh>
    </group>)}
    {/* Monitor: the screen faces the chair (+Z); the stand sits behind the
        panel (-Z), from a foot on the desk up to a mount on the panel's back. */}
    <RoundedBox position={[0, 1.04, -.74]} args={[.46, .022, .28]} radius={.01} castShadow><meshStandardMaterial color="#5e6478" /></RoundedBox>
    <mesh position={[0, 1.3, -.74]}><boxGeometry args={[.08, .5, .06]} /><meshStandardMaterial color="#5e6478" /></mesh>
    <mesh position={[0, 1.5, -.7]}><boxGeometry args={[.22, .18, .03]} /><meshStandardMaterial color="#4c5266" /></mesh>
    <RoundedBox position={[0, 1.58, -.64]} args={[1.42, .87, .09]} radius={.045} castShadow><meshStandardMaterial color="#101c2c" /></RoundedBox>
    <mesh ref={monitor} position={[0, 1.58, -.583]}><planeGeometry args={[1.29, .75]} /><meshStandardMaterial color={screen} emissive={screen} emissiveIntensity={.3} roughness={.3} /></mesh>
    <mesh position={[0, 1.58, -.565]}><planeGeometry args={[1.14, .61]} /><meshStandardMaterial color="#0e2137" emissive="#0c2235" emissiveIntensity={.4} /></mesh>
    {/* Code lines are left-aligned inside the inner screen (x -.57..+.57) with a margin. */}
    {Array.from({ length: 5 }, (_, i) => { const width = .28 + (i % 3) * .16; return <mesh key={i} position={[-.49 + width / 2, 1.78 - .115 * i, -.554]}>
      <planeGeometry args={[width, .022]} /><meshBasicMaterial color={i === 0 ? screen : i === 3 ? '#7b9eba' : '#3d5b79'} />
    </mesh> })}
    <RoundedBox position={[0, 1.051, .16]} args={[1, .035, .34]} radius={.022}><meshStandardMaterial color="#2d354a" /></RoundedBox>
    {Array.from({length: 4}, (_,row) => Array.from({length: 8}, (_,col) => <mesh key={`key-${row}-${col}`} position={[-.375 + col * .103, 1.072, .048 + row * .073]}>
      <boxGeometry args={[.078, .008, .05]}/><meshStandardMaterial color="#9eacc0" roughness={.76}/>
    </mesh>))}
    <mesh position={[.59, 1.063, .16]}><cylinderGeometry args={[.1, .1, .04, 12]} /><meshStandardMaterial color="#242d3a" /></mesh>
    <mesh position={[-.85, 1.038, -.4]}><cylinderGeometry args={[.15, .15, .016, 16]}/><meshStandardMaterial color="#b5bdc8" roughness={.8}/></mesh>
    <mesh position={[-.85, 1.12, -.4]}><cylinderGeometry args={[.12, .10, .14, 12]}/><meshStandardMaterial color={screen}/></mesh>
    <RoundedBox position={[.85, 1.052, -.31]} args={[.43, .035, .26]} radius={.018} castShadow>
      <meshStandardMaterial color="#f5f0df" roughness={.9}/>
    </RoundedBox>
    <mesh position={[.85, 1.074, -.31]}><boxGeometry args={[.35, .004, .17]}/><meshStandardMaterial color="#cbd9e5"/></mesh>
    <mesh position={[1.03, 1.13, -.44]}><cylinderGeometry args={[.074, .085, .19, 10]}/><meshStandardMaterial color="#6f88a0"/></mesh>
    {[-.02, .02].map((offset, i) => <mesh key={i} position={[1.03 + offset, 1.28, -.44]} rotation={[0, 0, offset * 2]}>
      <cylinderGeometry args={[.011, .011, .21, 7]}/><meshStandardMaterial color={i ? '#ffd58f' : '#90c5cf'}/>
    </mesh>)}
  </group>
}

function Workstation({ seat, simulation, selected, pose, onSelect, preferences, avatars }: {
  seat: Seat; simulation: RefObject<OfficeSimulation>; selected: boolean; pose: AgentPose; onSelect: () => void; preferences: OfficePreferences; avatars: RefObject<Map<string, Group>>
}) {
  const { agent, position } = seat
  const traveler = useRef<Group>(null)
  const walkRef = useRef(0)
  const gaitRef = useRef(0)
  const seatedRef = useRef(0)
  const lieRef = useRef(0)
  const coffeeRef = useRef(false)
  const idleRef = useRef<IdlePose | null>(null)
  const atDeskRef = useRef(false)
  useFrame((_, delta) => {
    if (!traveler.current) return
    const actor = simulation.current.get(agent.id)
    if (!actor) return
    const frame = actor.state
    traveler.current.userData.movementStage = frame.stage
    traveler.current.userData.coffeeBreak = frame.stage === 'coffee'
    traveler.current.userData.walking = frame.walking
    // 'working' is only reached after walking back and sitting down at this desk.
    atDeskRef.current = frame.stage === 'working'
    traveler.current.userData.atDesk = atDeskRef.current
    gaitRef.current = actor.gait
    const smoothing = Math.min(delta, .05)
    traveler.current.position.x = frame.position[0] - position[0]
    traveler.current.position.z = frame.position[1] - position[2]
    const turn = MathUtils.euclideanModulo(frame.facing - traveler.current.rotation.y + Math.PI, Math.PI * 2) - Math.PI
    traveler.current.rotation.y += MathUtils.clamp(turn, -smoothing * 5, smoothing * 5)
    walkRef.current = frame.walking ? 1 : 0
    // Map the simulated activity to an ambient pose (presentation only).
    const visit = frame.excursion >= 0 ? actor.plan.excursions[frame.excursion].activity : null
    // On the nap couch the "seated" transition lays the body down instead of sitting it.
    const napping = frame.stage === 'lounging' && visit === 'nap'
    seatedRef.current = napping ? 0 : frame.seated
    lieRef.current = napping ? frame.seated : 0
    coffeeRef.current = frame.stage === 'coffee'
    idleRef.current = frame.stage === 'browsing' ? 'browse'
      : frame.stage === 'lounging' ? (visit === 'chess' ? 'chess' : napping ? 'sleep' : 'lap')
      : frame.stage === 'viewing' ? (visit === 'darts' ? 'darts' : visit === 'pingpong' ? 'pingpong' : 'look')
      : frame.stage === 'idling' && (frame.activity === 'stretch' || frame.activity === 'phone' || frame.activity === 'pet') ? frame.activity : null
    traveler.current.userData.idleActivity = frame.activity ?? ''
    traveler.current.userData.sleeping = napping && frame.seated > .6
    traveler.current.userData.idleStatus = idleStatus(frame, visit)
  }, -.75)
  return <group position={position}>
    {/* Leads get gold desk trim; the screen and mug always use the agent's own colour. */}
    <Desk color={seat.placement === 'lead' ? '#ba9759' : agent.color} screen={agent.color} workingRef={atDeskRef} theme={preferences.theme} />
    <group ref={node => { traveler.current = node; if (node) avatars.current.set(agent.id, node); else avatars.current.delete(agent.id) }} position={[0, 0, STAND_Z]} rotation={[0, Math.PI, 0]}>
      <OfficeAvatar agent={agent} pose={pose} selected={selected} onSelect={onSelect} walkRef={walkRef} gaitRef={gaitRef} seatedRef={seatedRef} coffeeRef={coffeeRef} idleRef={idleRef} atDeskRef={atDeskRef} lieRef={lieRef} animate={preferences.motion !== 'off'}/>
    </group>
  </group>
}

function Studio({ translate, selected, tasks, schedules, readers, onOpenSchedules, onOpenKnowledge, onSelect, now, overlayId, layout, visibleSeats, distantSeats, overview, preferences }: { selected: AgentId; tasks: OfficeTask[]; schedules: OfficeSchedule[]; readers: KnowledgeReader[]; onOpenSchedules: () => void; onOpenKnowledge: () => void; onSelect: (value: AgentId) => void; now: number; overlayId: string; layout: OfficeLayout; visibleSeats: Seat[]; distantSeats: Seat[]; overview: boolean; preferences: OfficePreferences; translate: (text: string) => string }) {
  const { size } = useThree()
  const avatars = useRef(new Map<string, Group>())
  const agents = useAgents()
  const board = useMemo(() => scheduleBoardPosition(layout), [layout])
  const knowledge = useMemo(() => knowledgeGraphPosition(layout), [layout])
  const [initialSimulation] = useState(() => reconcileOfficeSimulation(layout, new Map(), new Set(tasks.filter(task => task.status === 'running').map(task => task.agentId))))
  const simulation = useRef<OfficeSimulation>(initialSimulation)
  useLayoutEffect(() => {
    simulation.current = reconcileOfficeSimulation(layout, simulation.current)
  }, [layout])
  const visibleIds = useMemo(() => new Set(visibleSeats.map(seat => seat.agent.id)), [visibleSeats])
  const detailedSectorKeys = useMemo(() => new Set(visibleSeats.map(seat => seat.sectorKey)), [visibleSeats])
  const activeIds = useMemo(() => new Set(tasks.filter(task => task.status === 'running').map(task => task.agentId)), [tasks])
  // Pets live beside the people: the layout remounts this scene, so they start fresh with it.
  const [initialPets] = useState(() => createOfficePets(layout))
  const pets = useRef<OfficePets>(initialPets)
  useFrame((_, delta) => {
    stepOfficeSimulation(simulation.current, visibleIds, activeIds, delta, preferences.motion, petVisits(pets.current))
    stepOfficePets(pets.current, layout, simulation.current, visibleIds, delta, preferences.motion)
  }, -1)
  const center = layout.seats.find(seat => seat.agent.id === selected)?.position || layout.sectors[0]?.center || [0, 0, 0]
  const target: [number, number, number] = overview ? [layout.width / 2, 1, layout.depth / 2] : [center[0], 1, center[2]]
  // Use the actual canvas size so every room fits on screen as the campus grows.
  // Keep enough room for badges while framing small shared offices tightly.
  // Fixed oversized margins made 1-4 agent teams appear miniature.
  const campusWidth = layout.width * .78 + layout.depth * .63 + 5.5
  const campusHeight = layout.width * .42 + layout.depth * .47 + 4.5
  const overviewZoom = Math.max(.1, Math.min(size.width * .89 / campusWidth, size.height * .86 / campusHeight))
  const cameraKey = overview ? `campus-${layout.width}-${layout.depth}` : `agent-${selected}`
  return <>
    <color attach="background" args={[preferences.theme === 'midnight' ? '#111b2e' : preferences.theme === 'warm' ? '#efe6df' : '#edf5fa']} />
    <ambientLight intensity={1.3} color="#d8e7ff" />
    <hemisphereLight args={['#aac6eb', '#293852', 1.7]} />
    <directionalLight position={[7, 14, 12]} intensity={2.4} color="#f4ecdc"
      castShadow={layout.seats.length <= 12}
      shadow-mapSize-width={2048} shadow-mapSize-height={2048}
      shadow-camera-left={-Math.max(16, layout.width + 2)}
      shadow-camera-right={Math.max(16, layout.width + 2)}
      shadow-camera-top={Math.max(16, layout.depth + 2)}
      shadow-camera-bottom={-Math.max(16, layout.depth + 2)}
      shadow-camera-near={.5} shadow-camera-far={95}
      shadow-normalBias={.028} shadow-bias={-.0002}/>
    <OfficeCampus layout={layout} preferences={preferences} detailedSectorKeys={detailedSectorKeys}/>
    <OfficeCrowdLOD seats={distantSeats} theme={preferences.theme} working={activeIds} simulation={simulation} onSelect={onSelect}/>
    {visibleSeats.map(seat => <Workstation key={seat.agent.id} seat={seat} simulation={simulation} selected={selected === seat.agent.id} pose={resolveAgentPose(selectAgentTask(tasks, seat.agent.id, now), now)} onSelect={() => onSelect(seat.agent.id)} preferences={preferences} avatars={avatars}/>)}
    <LoungeTV layout={layout} simulation={simulation}/>
    <GamesRoom layout={layout} preferences={preferences}/>
    <PingPongBall layout={layout} simulation={simulation}/>
    <OfficePetsView pets={pets}/>
    <ScheduleBoard layout={layout} schedules={schedules} agents={agents} accent={preferences.accent} onOpen={onOpenSchedules}/>
    <KnowledgeGraph layout={layout} readers={readers} agents={agents} accent={preferences.accent} animate={preferences.motion !== 'off'} onOpen={onOpenKnowledge}/>
    <BadgeProjector translate={translate} overlayId={overlayId} seats={visibleSeats} sectors={layout.sectors} avatars={avatars} board={board} knowledge={knowledge}/>
    <OrthographicCamera key={`${cameraKey}-camera`} makeDefault position={[target[0] + 15, target[1] + 17, target[2] + 19]} zoom={overview ? overviewZoom : 42} near={.1} far={Math.max(250, layout.width + layout.depth + 100)} />
    <OrbitControls key={`${cameraKey}-controls`} makeDefault target={target} minPolarAngle={.25} maxPolarAngle={1.46} enablePan enableDamping dampingFactor={.08} minZoom={overview ? Math.min(2, overviewZoom) : 12} maxZoom={165} />
    <FollowSelected key={`${cameraKey}-${center[0]}-${center[2]}`} selected={selected} overview={overview} avatars={avatars} center={center}/>
  </>
}

export default function OfficeScene({ selected, tasks, schedules = [], onOpenSchedules = () => {}, onOpenKnowledge = () => {}, onSelect, overview = false }: { selected: AgentId; tasks: OfficeTask[]; schedules?: OfficeSchedule[]; onOpenSchedules?: (agentId?: AgentId | null) => void; onOpenKnowledge?: () => void; onSelect: (value: AgentId) => void; overview?: boolean }) {
  const { t: tr } = useLanguage()
  const agents = useAgents()
  const { preferences } = useOfficePreferences()
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReducedMotion(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  const effectivePreferences = useMemo(() => reducedMotion ? { ...preferences, motion: 'off' as const } : preferences, [preferences, reducedMotion])
  const desiredLayout = useMemo(() => makeOfficeLayout(agents, preferences.spacing), [agents, preferences.spacing])
  const desiredKey = useMemo(() => layoutGeometryKey(desiredLayout), [desiredLayout])
  const [presentation, setPresentation] = useState(() => ({ layout: desiredLayout, key: desiredKey, phase: 'ready' }))
  const presentationRef = useRef(presentation)
  useLayoutEffect(() => { presentationRef.current = presentation }, [presentation])
  const desiredRef = useRef({ layout: desiredLayout, key: desiredKey })
  useLayoutEffect(() => { desiredRef.current = { layout: desiredLayout, key: desiredKey } }, [desiredLayout, desiredKey])
  // Profile/activity snapshots must not reset a geometry transition's deadlines.
  useEffect(() => {
    const timer = window.setTimeout(() => setPresentation(value => value.key === desiredKey && value.layout !== desiredLayout
      ? { ...value, layout: desiredLayout } : value), 0)
    return () => window.clearTimeout(timer)
  }, [desiredLayout, desiredKey])
  useEffect(() => {
    const current = presentationRef.current
    if (current.key === desiredKey && current.phase === 'ready') return
    const timers: number[] = []
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 16 : 220
    timers.push(window.setTimeout(() => setPresentation(value => ({ ...value, phase: current.key === desiredKey ? 'opening' : 'closing' })), 0))
    timers.push(window.setTimeout(() => {
      const latest = desiredRef.current
      setPresentation({ layout: latest.layout, key: latest.key, phase: 'opening' })
      timers.push(window.setTimeout(() => setPresentation(value => ({ ...value, phase: 'ready' })), delay))
    }, delay))
    return () => timers.forEach(window.clearTimeout)
  }, [desiredKey])
  const layout = presentation.layout
  // Keep nearby stations detailed at large team sizes; focus another agent to inspect their wing.
  const visibleSeats = useMemo(() => {
    if (layout.seats.length <= 50) return layout.seats
    const selectedSeat = layout.seats.find(seat => seat.agent.id === selected) || layout.seats[0]
    return [...layout.seats].sort((a, b) => {
      const dist = (seat: Seat) => (seat.position[0] - selectedSeat.position[0]) ** 2 + (seat.position[2] - selectedSeat.position[2]) ** 2
      return dist(a) - dist(b)
    }).slice(0, 50)
  }, [layout, selected])
  const distantSeats = useMemo(() => {
    if (layout.seats.length <= 50) return []
    const close = new Set(visibleSeats.map(seat => seat.agent.id))
    return layout.seats.filter(seat => !close.has(seat.agent.id))
  }, [layout, visibleSeats])
  const overlayId = useId()
  const scheduledAgents = useMemo(() => new Set(schedules.filter(item => item.enabled && item.nextRunAt).map(item => item.agentId)), [schedules])
  const upcomingCount = schedules.filter(item => item.enabled && item.nextRunAt).length
  const readers = useKnowledgeReaders(tasks)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timeout = window.setTimeout(() => setNow(Date.now()), 0)
    return () => window.clearTimeout(timeout)
  }, [tasks])
  useEffect(() => {
    const current = Date.now()
    const expiries = tasks.filter(task => ['completed', 'failed', 'interrupted'].includes(task.status))
      .map(task => Date.parse(task.finishedAt || '') + TERMINAL_POSE_MS)
      .filter(expiry => Number.isFinite(expiry) && expiry > current)
    if (!expiries.length) return
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(...expiries) - current + 25)
    return () => window.clearTimeout(timeout)
  }, [tasks, now])
  return <div className="office-3d-shell" data-office-theme={preferences.theme} data-office-motion={effectivePreferences.motion} data-layout-transition={presentation.phase} aria-busy={presentation.phase !== 'ready'}>
    <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true, alpha: false }} onPointerMissed={() => { }}>
      <Studio key={presentation.key} translate={tr} selected={selected} tasks={tasks} schedules={schedules} readers={readers} onOpenSchedules={() => onOpenSchedules(null)} onOpenKnowledge={onOpenKnowledge} onSelect={onSelect} now={now} overlayId={overlayId} layout={layout} visibleSeats={visibleSeats} distantSeats={distantSeats} overview={overview} preferences={effectivePreferences}/>
    </Canvas>
    {presentation.phase === 'closing' && <div className="scene-layout-loading" role="status">{tr('Loading 3D office…')}</div>}
    <div id={overlayId} className={`scene-phase-overlay${overview ? ' is-overview' : ''}`} aria-label={tr('Current phase')}>
      {visibleSeats.map(({ agent }) => {
        const task = selectAgentTask(tasks, agent.id, now)
        const pose = resolveAgentPose(task, now)
        const text = pose === 'celebrating' ? statusName.completed : pose === 'error' ? statusName[task?.status || 'failed'] : phaseName[pose]
        return <span key={agent.id} className={`scene-phase-label phase-${pose}`} data-agent={agent.id} data-pose={pose}>
          <i aria-hidden="true" /><span className="label-phase">{tr(text)}</span><span className="label-idle"/><span className="label-away">{tr('Heading to desk')}</span><span className="label-sleep"><Moon size={10} aria-hidden="true"/>{tr('Sleeping')}</span>{scheduledAgents.has(agent.id) && <CalendarClock className="label-schedule" size={10} aria-label="Has scheduled tasks"/>}
        </span>
      })}
      <button type="button" className="scene-board-label" data-board="schedule" onClick={() => onOpenSchedules(null)}
        aria-label={`Open scheduled tasks (${upcomingCount} upcoming)`}>
        <CalendarClock size={12} aria-hidden="true"/>Schedules<b>{upcomingCount}</b>
      </button>
      <button type="button" className={`scene-board-label scene-knowledge-label${readers.length ? ' is-reading' : ''}`} data-board="knowledge" onClick={onOpenKnowledge}
        aria-label={readers.length ? `Open knowledge graph (${readers.length} agent${readers.length > 1 ? 's' : ''} reading)` : 'Open knowledge graph'}>
        <Network size={12} aria-hidden="true"/>Knowledge{readers.length > 0 && <b>{readers.length}</b>}
      </button>
      {layout.sectors.map(sector => <span key={sector.key} className="scene-sector-label" data-sector={sector.key}>
        <i style={{ background: preferences.sectorColors[sector.id] || DEPARTMENTS.find(dep => dep.id === sector.id)?.color }}/>{overview ? tr(DEPARTMENTS.find(dep => dep.id === sector.id)?.name || sector.id).split(/[ &]+/)[0] : tr(DEPARTMENTS.find(dep => dep.id === sector.id)?.name || sector.id)} · {sector.count}
      </span>)}
    </div>
  </div>
}
