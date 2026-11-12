import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import { CanvasTexture, MathUtils, SRGBColorSpace, Vector3, type Group, type Mesh, type Sprite } from 'three'
import type { OfficeAgent } from '../types'
import { presentedPose, type AgentPose } from './agentBehavior'
import { makeAvatarRigPose, type IdleBlend, type IdlePose, type RigPoint } from './avatarRig'
import { LIE_LIFT } from './loungeLayout'

// One shared "Z" texture for every sleeping avatar.
let zTexture: CanvasTexture | null = null
function sleepTexture() {
  if (zTexture) return zTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    context.font = "900 52px 'DM Sans', system-ui, sans-serif"
    context.textAlign = 'center'; context.textBaseline = 'middle'
    context.lineWidth = 8; context.strokeStyle = '#2c3b55'; context.strokeText('Z', 32, 34)
    context.fillStyle = '#eef3ff'; context.fillText('Z', 32, 34)
  }
  zTexture = new CanvasTexture(canvas)
  zTexture.colorSpace = SRGBColorSpace
  return zTexture
}

const UP = new Vector3(0, 1, 0)
const BONE_START = new Vector3()
const BONE_DIRECTION = new Vector3()

// Every animated limb is a continuous joint-to-joint bone. Connecting the
// segments to the same elbow/knee coordinates prevents floating hands and gaps.
function fitBone(mesh: Mesh | undefined, start: RigPoint, end: RigPoint) {
  if (!mesh) return
  const a = BONE_START.set(...start)
  const direction = BONE_DIRECTION.set(...end).sub(a)
  const length = direction.length()
  mesh.position.copy(a.addScaledVector(direction, .5))
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize())
  mesh.scale.y = length
}

export function OfficeAvatar({ agent, pose, selected, onSelect, walkRef, gaitRef, seatedRef, coffeeRef, idleRef, atDeskRef, lieRef, animate = true }: {
  agent: OfficeAgent; pose: AgentPose; selected: boolean; onSelect: () => void
  walkRef: RefObject<number>; gaitRef: RefObject<number>; seatedRef: RefObject<number>; coffeeRef: RefObject<boolean>
  /** Current ambient idle pose, if any. */
  idleRef?: RefObject<IdlePose | null>
  /** True only while seated at the agent's own desk working; gates work poses. */
  atDeskRef?: RefObject<boolean>
  /** 0..1: lying down on the nap couch (the whole body tips back onto the cushion). */
  lieRef?: RefObject<number>
  animate?: boolean
}) {
  const model = useRef<Group>(null)
  const torso = useRef<Group>(null)
  const head = useRef<Group>(null)
  const upperArms = useRef<Mesh[]>([])
  const lowerArms = useRef<Mesh[]>([])
  const hands = useRef<Group[]>([])
  const elbows = useRef<Mesh[]>([])
  const thighs = useRef<Mesh[]>([])
  const shins = useRef<Mesh[]>([])
  const knees = useRef<Mesh[]>([])
  const shoes = useRef<Mesh[]>([])
  const halo = useRef<Mesh>(null)
  const coffeeCup = useRef<Group>(null)
  const coffeeBlend = useRef(0)
  const coffeeTime = useRef(0)
  const thinkingBlend = useRef(0)
  const walkBlend = useRef(0)
  const idleBlend = useRef<Required<IdleBlend>>({ browse: 0, lap: 0, stretch: 0, phone: 0, look: 0, darts: 0, pingpong: 0, chess: 0, sleep: 0, pet: 0 })
  const eyes = useRef<Mesh[]>([])
  const sleepZs = useRef<Sprite[]>([])
  const sleepGroup = useRef<Group>(null)
  const phone = useRef<Group>(null)
  const paddle = useRef<Group>(null)
  const dart = useRef<Group>(null)
  const skin = agent.id === 'sentinel' ? '#c48c70' : agent.id === 'pixel' ? '#efc8ab' : '#dbad8c'
  const hair = agent.id === 'nova' ? '#2b4058' : agent.id === 'pixel' ? '#894f47' : agent.id === 'sentinel' ? '#41332f' : '#282b43'

  useFrame(({ clock }, delta) => {
    const t = animate ? clock.elapsedTime : 0
    const shown = presentedPose(pose, atDeskRef?.current ?? true)
    thinkingBlend.current = MathUtils.damp(thinkingBlend.current, shown === 'thinking' ? 1 : 0, 4, Math.min(delta, .05))
    walkBlend.current = MathUtils.damp(walkBlend.current, walkRef.current, 8, Math.min(delta, .05))
    coffeeBlend.current = MathUtils.damp(coffeeBlend.current, coffeeRef.current ? 1 : 0, 5, Math.min(delta, .05))
    coffeeTime.current = coffeeRef.current ? coffeeTime.current + Math.min(delta, .05) : 0
    const idlePose = idleRef?.current ?? null
    for (const name of Object.keys(idleBlend.current) as IdlePose[]) {
      idleBlend.current[name] = MathUtils.damp(idleBlend.current[name], idlePose === name ? 1 : 0, 4.5, Math.min(delta, .05))
    }
    if (phone.current) phone.current.visible = idleBlend.current.phone > .35
    if (paddle.current) paddle.current.visible = idleBlend.current.pingpong > .35
    if (dart.current) dart.current.visible = idleBlend.current.darts > .35
    if (coffeeCup.current) { coffeeCup.current.visible = coffeeBlend.current > .2; coffeeCup.current.rotation.x = -.18 * (.5 - .5 * Math.cos(coffeeTime.current * 1.35)) }
    const rig = makeAvatarRigPose(seatedRef.current, walkBlend.current, t, shown, thinkingBlend.current, gaitRef.current, coffeeBlend.current, coffeeTime.current, idleBlend.current)
    // Breathing moves the upper body, never lifts the planted shoes off the floor.
    // Napping tips the whole body back about the feet onto the couch: head toward -Z, face up.
    const lieInput = MathUtils.clamp(lieRef?.current ?? 0, 0, 1), lie = lieInput * lieInput * (3 - 2 * lieInput)
    if (model.current) { model.current.position.y = lie * LIE_LIFT; model.current.rotation.x = -lie * Math.PI / 2 }
    const sleep = idleBlend.current.sleep * lie
    for (const eye of eyes.current) if (eye) eye.scale.y = 1.2 * (1 - .88 * sleep)
    if (sleepGroup.current) sleepGroup.current.visible = sleep > .6
    sleepZs.current.forEach((z, index) => {
      if (!z) return
      // Three Zs drift up from the face in turn, growing and fading.
      const phase = animate ? (clock.elapsedTime * .45 + index / 3) % 1 : index / 3
      z.position.set(Math.sin(phase * 5 + index) * .08, phase * .7, -phase * .1)
      z.scale.setScalar(.12 + phase * .14)
      z.material.opacity = Math.min(1, phase * 4) * (1 - phase)
    })
    if (torso.current) {
      torso.current.position.y = -rig.torsoDrop + rig.bob
      torso.current.rotation.x = MathUtils.damp(torso.current.rotation.x, shown === 'error' ? .1 : idleBlend.current.pet * .12 - idleBlend.current.lap * .07, 7, Math.min(delta, .05))
    }
    if (head.current) {
      head.current.rotation.x = MathUtils.damp(head.current.rotation.x, rig.headPitch, 7, Math.min(delta, .05))
      head.current.rotation.z = MathUtils.damp(head.current.rotation.z, rig.headRoll, 7, Math.min(delta, .05))
    }
    rig.arms.forEach((arm, index) => {
      fitBone(upperArms.current[index], arm.shoulder, arm.elbow)
      fitBone(lowerArms.current[index], arm.elbow, arm.wrist)
      if (elbows.current[index]) elbows.current[index].position.set(...arm.elbow)
      if (hands.current[index]) hands.current[index].position.set(...arm.wrist)
    })
    rig.legs.forEach((leg, index) => {
      fitBone(thighs.current[index], leg.hip, leg.knee)
      fitBone(shins.current[index], leg.knee, leg.ankle)
      if (knees.current[index]) knees.current[index].position.set(...leg.knee)
      if (shoes.current[index]) {
        shoes.current[index].position.set(...leg.foot)
        shoes.current[index].rotation.x = rig.shoePitch[index]
      }
    })
    if (halo.current) halo.current.rotation.z = t * .3
  })

  return <group onClick={event => { event.stopPropagation(); onSelect() }}
    onPointerOver={event => { event.stopPropagation(); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { document.body.style.cursor = 'auto' }}>
    {selected && <mesh ref={halo} position={[0, .035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[.57, .028, 8, 48]}/><meshBasicMaterial color={agent.color} toneMapped={false}/>
    </mesh>}
    <group ref={sleepGroup} visible={false} position={[0, LIE_LIFT + .5, -1.95]}>
      {[0, 1, 2].map(index => <sprite key={index} ref={node => { if (node) sleepZs.current[index] = node }}>
        <spriteMaterial map={sleepTexture()} transparent depthWrite={false} toneMapped={false}/>
      </sprite>)}
    </group>
    <group ref={model}>
      <group ref={torso}>
        <RoundedBox position={[0, 1.40, -.045]} args={[.7, .70, .48]} radius={.21} castShadow>
          <meshStandardMaterial color={agent.color} roughness={.88}/>
        </RoundedBox>
        <RoundedBox position={[0, 1.13, -.055]} args={[.54, .23, .42]} radius={.09} castShadow>
          <meshStandardMaterial color="#344b66" roughness={.9}/>
        </RoundedBox>
        <mesh position={[0, 1.635, .214]}><boxGeometry args={[.13, .075, .014]}/><meshStandardMaterial color="#e9eef4"/></mesh>
        {[-1, 1].map(side => <RoundedBox key={side} position={[side * .365, 1.61, -.02]} args={[.245, .255, .32]} radius={.105} castShadow>
          <meshStandardMaterial color={agent.color} roughness={.9}/>
        </RoundedBox>)}
        <mesh position={[0, 1.775, -.015]}><cylinderGeometry args={[.105, .105, .19, 10]}/><meshStandardMaterial color={skin}/></mesh>
        <group ref={head} position={[0, 1.98, 0]}>
          <mesh castShadow><sphereGeometry args={[.275, 20, 16]}/><meshStandardMaterial color={skin} roughness={.83}/></mesh>
          <mesh position={[0, .105, -.018]} castShadow><sphereGeometry args={[.287, 20, 14, 0, Math.PI * 2, 0, Math.PI * .55]}/><meshStandardMaterial color={hair} roughness={.91}/></mesh>
          {[-1, 1].map(side => <group key={side}>
            <mesh ref={node => { if (node) eyes.current[side === -1 ? 0 : 1] = node }} position={[side * .117, .013, .247]} scale={[.8, 1.2, .65]}><sphereGeometry args={[.023, 9, 7]}/><meshStandardMaterial color="#172638"/></mesh>
            <mesh position={[side * .117, .09, .235]} rotation={[0, 0, side * -.14]}><boxGeometry args={[.085, .018, .017]}/><meshStandardMaterial color={hair}/></mesh>
            <mesh position={[side * .271, -.04, 0]}><sphereGeometry args={[.062, 8, 8]}/><meshStandardMaterial color={skin}/></mesh>
          </group>)}
          <mesh position={[0, -.048, .269]}><sphereGeometry args={[.036, 9, 7]}/><meshStandardMaterial color={skin}/></mesh>
          <mesh position={[0, -.132, .242]} rotation={[0, 0, Math.PI]}><torusGeometry args={[.06, .008, 5, 16, Math.PI]}/><meshStandardMaterial color="#814d4a"/></mesh>
        </group>
      </group>
      {[-1, 1].map((side, index) => <group key={`arm-${side}`}>
        <mesh ref={node => { if (node) upperArms.current[index] = node }} castShadow>
          <cylinderGeometry args={[.108, .112, 1, 10]}/><meshStandardMaterial color={agent.color} roughness={.88}/>
        </mesh>
        <mesh ref={node => { if (node) elbows.current[index] = node }} castShadow>
          <sphereGeometry args={[.084, 10, 8]}/><meshStandardMaterial color={skin} roughness={.87}/>
        </mesh>
        <mesh ref={node => { if (node) lowerArms.current[index] = node }} castShadow>
          <cylinderGeometry args={[.079, .086, 1, 10]}/><meshStandardMaterial color={skin} roughness={.86}/>
        </mesh>
        <group ref={node => { if (node) hands.current[index] = node }}>
          <RoundedBox args={[.16, .085, .145]} radius={.034} castShadow>
            <meshStandardMaterial color={skin} roughness={.86}/>
          </RoundedBox>
          {[-.056, -.019, .019, .056].map((x, finger) => <RoundedBox key={finger}
            position={[x, -.012, .103 + (finger === 1 || finger === 2 ? .012 : 0)]}
            args={[.031, .047, finger === 1 || finger === 2 ? .112 : .09]} radius={.015} castShadow>
            <meshStandardMaterial color={skin} roughness={.86}/>
          </RoundedBox>)}
          {/* Palm down with fingers forward, the thumb sits on the inner side, toward the body's midline. */}
          <RoundedBox position={[-side * .102, -.026, .012]} rotation={[0, -side * .3, 0]}
            args={[.058, .061, .085]} radius={.025} castShadow>
            <meshStandardMaterial color={skin} roughness={.86}/>
          </RoundedBox>
          {side === 1 && <group ref={paddle} visible={false} position={[0, .02, .17]} rotation={[0, 0, Math.PI / 2]}>
            {/* Table tennis paddle: red rubber face on a wooden handle. */}
            <mesh position={[0, -.04, 0]}><cylinderGeometry args={[.02, .022, .1, 8]}/><meshStandardMaterial color="#b7895b"/></mesh>
            <mesh position={[0, .07, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.085, .085, .014, 18]}/><meshStandardMaterial color="#d33a3a" roughness={.7}/></mesh>
          </group>}
          {side === 1 && <group ref={dart} visible={false} position={[0, .03, .12]} rotation={[Math.PI / 2, 0, 0]}>
            {/* A dart pinched between the fingers, pointing forward. */}
            <mesh><cylinderGeometry args={[.007, .007, .12, 6]}/><meshStandardMaterial color="#c9ced6" metalness={.7}/></mesh>
            <mesh position={[0, .07, 0]}><coneGeometry args={[.006, .03, 6]}/><meshStandardMaterial color="#e5e7eb" metalness={.8}/></mesh>
            <mesh position={[0, -.07, 0]} rotation={[0, Math.PI / 4, 0]}><boxGeometry args={[.04, .035, .002]}/><meshStandardMaterial color="#e2566b"/></mesh>
          </group>}
          {side === 1 && <group ref={phone} visible={false} position={[-.05, .05, .1]} rotation={[-.9, 0, 0]}>
            {/* A phone held in both hands, screen toward the face. */}
            <RoundedBox args={[.11, .19, .018]} radius={.012} castShadow><meshStandardMaterial color="#1c2433" roughness={.4}/></RoundedBox>
            <mesh position={[0, .005, .0095]}><planeGeometry args={[.092, .16]}/><meshBasicMaterial color="#7fc4f2" toneMapped={false}/></mesh>
          </group>}
          {side === 1 && <group ref={coffeeCup} visible={false} position={[0, .065, .16]}>
            <mesh castShadow>
              <cylinderGeometry args={[.056, .046, .14, 14]}/><meshStandardMaterial color="#f7f1e6" roughness={.46}/>
            </mesh>
            <mesh position={[0, .066, 0]}>
              <cylinderGeometry args={[.047, .047, .006, 14]}/><meshStandardMaterial color="#75503d" roughness={.42}/>
            </mesh>
            <mesh position={[.06, .006, 0]} rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[.037, .009, 7, 14]}/><meshStandardMaterial color="#eee7dc" roughness={.5}/>
            </mesh>
          </group>}
        </group>
      </group>)}
      {[-1, 1].map((side, index) => <group key={`leg-${side}`}>
        <mesh ref={node => { if (node) thighs.current[index] = node }} castShadow>
          <cylinderGeometry args={[.134, .145, 1, 10]}/><meshStandardMaterial color="#344961" roughness={.9}/>
        </mesh>
        <mesh ref={node => { if (node) knees.current[index] = node }} castShadow>
          <sphereGeometry args={[.122, 10, 8]}/><meshStandardMaterial color="#344961" roughness={.9}/>
        </mesh>
        <mesh ref={node => { if (node) shins.current[index] = node }} castShadow>
          <cylinderGeometry args={[.105, .125, 1, 10]}/><meshStandardMaterial color="#344961" roughness={.9}/>
        </mesh>
        <RoundedBox ref={node => { if (node) shoes.current[index] = node }} args={[.275, .12, .39]} radius={.045} castShadow>
          <meshStandardMaterial color="#233248" roughness={.86}/>
          {/* Raised shoe collar overlaps the ankle and shin on every frame. */}
          <RoundedBox position={[0, .105, -.075]} args={[.205, .205, .22]} radius={.054} castShadow>
            <meshStandardMaterial color="#233248" roughness={.86}/>
          </RoundedBox>
          <mesh position={[0, -.055, .022]}><boxGeometry args={[.29, .035, .405]}/><meshStandardMaterial color="#c1cbd6" roughness={.84}/></mesh>
          <mesh position={[0, .062, .07]}><boxGeometry args={[.16, .011, .12]}/><meshStandardMaterial color="#dce4ed" roughness={.87}/></mesh>
        </RoundedBox>
      </group>)}
    </group>
  </group>
}
