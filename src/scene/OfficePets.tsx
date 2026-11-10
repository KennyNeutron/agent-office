import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import { MathUtils, type Group } from 'three'
import type { OfficePets as Pets, PetKind } from './petSimulation'

// Low-poly office pets. Local +Z is forward, like the avatars. Poses blend
// between walking (legs swing with the gait), sitting beside an agent (tail
// wagging) and curled up asleep in a bed or by a napping agent.
const LOOK: Record<PetKind, { coat: string; dark: string; belly: string; scale: number }> = {
  dog: { coat: '#c98b4b', dark: '#7a4a24', belly: '#ecd2ad', scale: 1 },
  cat: { coat: '#8d939e', dark: '#4f5560', belly: '#e6e3dd', scale: .68 },
}

function Pet({ kind, pets, index }: { kind: PetKind; pets: RefObject<Pets>; index: number }) {
  const root = useRef<Group>(null), body = useRef<Group>(null), head = useRef<Group>(null), tail = useRef<Group>(null)
  const legs = useRef<(Group | null)[]>([])
  const sit = useRef(0), curl = useRef(0)
  const look = LOOK[kind]
  useFrame(({ clock }, delta) => {
    const pet = pets.current[index]
    if (!pet || !root.current || !body.current) return
    const step = Math.min(delta, .05), t = clock.elapsedTime
    root.current.position.set(pet.position[0], 0, pet.position[1])
    const turn = MathUtils.euclideanModulo(pet.facing - root.current.rotation.y + Math.PI, Math.PI * 2) - Math.PI
    root.current.rotation.y += MathUtils.clamp(turn, -step * 7, step * 7)
    sit.current = MathUtils.damp(sit.current, pet.stage === 'visiting' ? 1 : 0, 6, step)
    curl.current = MathUtils.damp(curl.current, pet.stage === 'resting' || pet.stage === 'napping' ? 1 : 0, 4, step)
    const s = sit.current, c = curl.current
    // Sitting lowers the rear (body pitches up); curling lowers the whole body to the floor.
    body.current.position.y = .46 - s * .08 - c * .3
    body.current.rotation.x = -s * .5
    if (head.current) {
      head.current.rotation.x = MathUtils.damp(head.current.rotation.x, c * .5 - s * .15, 5, step)
      head.current.rotation.y = c * .5 + (pet.walking ? 0 : Math.sin(t * .4 + index) * .25 * (1 - c))
    }
    legs.current.forEach((leg, legIndex) => {
      if (!leg) return
      const front = legIndex < 2, side = legIndex % 2 ? 1 : -1
      const swing = pet.walking ? Math.sin(pet.gait + (front === (side === 1) ? 0 : Math.PI)) * .55 : 0
      // Rear legs fold under while sitting; every leg tucks in when curled up.
      leg.rotation.x = swing + (!front ? s * 1.2 : 0)
      leg.scale.y = 1 - c * .85
    })
    if (tail.current) {
      // Wagging while visiting or walking; a slow sway at rest.
      const wag = pet.stage === 'visiting' ? Math.sin(t * (kind === 'dog' ? 14 : 3)) * .7 : pet.walking ? Math.sin(t * 6) * .3 : Math.sin(t * .8) * .1
      tail.current.rotation.y = wag
      tail.current.rotation.x = (kind === 'dog' ? -.7 : -1.1) * (1 - c) + c * .2 + s * .4
    }
  })
  const legLength = .34
  return <group ref={root} name={`pet-${kind}`} scale={look.scale}>
    <group ref={body}>
      <RoundedBox args={[.32, .3, .62]} radius={.12} castShadow><meshStandardMaterial color={look.coat} roughness={.95}/></RoundedBox>
      <RoundedBox position={[0, -.1, .02]} args={[.26, .12, .48]} radius={.05}><meshStandardMaterial color={look.belly} roughness={.95}/></RoundedBox>
      {[[-.11, .22], [.11, .22], [-.11, -.22], [.11, -.22]].map(([x, z], legIndex) => <group key={legIndex} position={[x, -.06, z]} ref={node => { legs.current[legIndex] = node }}>
        <mesh position={[0, -legLength / 2, 0]} castShadow><cylinderGeometry args={[.05, .045, legLength, 8]}/><meshStandardMaterial color={look.coat} roughness={.95}/></mesh>
        <mesh position={[0, -legLength, .02]}><sphereGeometry args={[.055, 8, 6]}/><meshStandardMaterial color={look.belly} roughness={.95}/></mesh>
      </group>)}
      <group ref={head} position={[0, .15, .36]}>
        {kind === 'dog' ? <>
          <RoundedBox args={[.26, .25, .26]} radius={.09} castShadow><meshStandardMaterial color={look.coat} roughness={.95}/></RoundedBox>
          <RoundedBox position={[0, -.05, .16]} args={[.15, .12, .16]} radius={.05}><meshStandardMaterial color={look.belly} roughness={.95}/></RoundedBox>
          <mesh position={[0, -.01, .245]}><sphereGeometry args={[.032, 8, 6]}/><meshStandardMaterial color="#1c1f26"/></mesh>
          {[-1, 1].map(side => <RoundedBox key={side} position={[side * .14, -.02, -.02]} rotation={[0, 0, side * .25]} args={[.06, .2, .12]} radius={.03}>
            <meshStandardMaterial color={look.dark} roughness={.95}/>
          </RoundedBox>)}
        </> : <>
          <mesh castShadow><sphereGeometry args={[.15, 14, 12]}/><meshStandardMaterial color={look.coat} roughness={.95}/></mesh>
          <mesh position={[0, -.04, .12]}><sphereGeometry args={[.06, 10, 8]}/><meshStandardMaterial color={look.belly} roughness={.95}/></mesh>
          <mesh position={[0, -.01, .155]}><sphereGeometry args={[.022, 8, 6]}/><meshStandardMaterial color="#d98c95"/></mesh>
          {[-1, 1].map(side => <mesh key={side} position={[side * .085, .13, -.01]} rotation={[0, 0, side * -.3]}>
            <coneGeometry args={[.055, .12, 4]}/><meshStandardMaterial color={look.dark} roughness={.95}/>
          </mesh>)}
        </>}
        {[-1, 1].map(side => <mesh key={`eye-${side}`} position={[side * .065, .04, kind === 'dog' ? .135 : .13]}>
          <sphereGeometry args={[.022, 8, 6]}/><meshStandardMaterial color="#141820"/>
        </mesh>)}
      </group>
      <group ref={tail} position={[0, .08, -.3]}>
        <mesh position={[0, 0, -(kind === 'dog' ? .13 : .2)]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[.035, .025, kind === 'dog' ? .26 : .42, 7]}/><meshStandardMaterial color={kind === 'dog' ? look.coat : look.dark} roughness={.95}/>
        </mesh>
      </group>
    </group>
  </group>
}

function PetBed({ x, z, kind }: { x: number; z: number; kind: PetKind }) {
  const radius = kind === 'dog' ? .5 : .36
  return <group position={[x, 0, z]} name={`pet-bed-${kind}`}>
    <mesh position={[0, .07, 0]} receiveShadow castShadow><cylinderGeometry args={[radius, radius + .03, .14, 24]}/><meshStandardMaterial color={kind === 'dog' ? '#5f7fa3' : '#b56f86'} roughness={.95}/></mesh>
    <mesh position={[0, .1, 0]}><cylinderGeometry args={[radius - .1, radius - .1, .1, 24]}/><meshStandardMaterial color="#efe6d6" roughness={1}/></mesh>
    {kind === 'dog' && <mesh position={[radius + .15, .03, .1]}><cylinderGeometry args={[.11, .12, .06, 16]}/><meshStandardMaterial color="#c9d3de" metalness={.4}/></mesh>}
  </group>
}

/** The dog and the cat, plus their beds, driven by the pet simulation. */
export function OfficePetsView({ pets }: { pets: RefObject<Pets> }) {
  const list = pets.current
  return <group name="office-pets">
    {list.map((pet, index) => <group key={pet.id}>
      <PetBed x={pet.bed[0]} z={pet.bed[1]} kind={pet.kind}/>
      <Pet kind={pet.kind} pets={pets} index={index}/>
    </group>)}
  </group>
}


