import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { Group } from 'three'
import type { OfficeLayout } from './officeLayout'
import type { OfficePreferences } from './officePreferences'
import { officeWalls, WALL, wallPieces, type OfficeWall } from './wallLayout'

const COLORS = {
  daylight: { wall: '#cbd8e3', trim: '#8ea6b9', glass: '#9dcae7' },
  midnight: { wall: '#3a5067', trim: '#6a849c', glass: '#6a98bd' },
  warm: { wall: '#dfc8b2', trim: '#b8967b', glass: '#add5e5' },
} as const

// Like the bay back walls, a wall between the camera and the room it fronts is
// cut down, so it never hides the agents inside.
function InteriorWall({ wall, theme }: { wall: OfficeWall; theme: OfficePreferences['theme'] }) {
  const full = useRef<Group>(null)
  const low = useRef<Group>(null)
  const colors = COLORS[theme]
  const pieces = wallPieces(wall)
  const { thickness, height, sill, low: lowHeight } = WALL
  useFrame(({ camera }) => {
    if (!full.current || !low.current) return
    const side = (wall.axis === 'x' ? camera.position.z : camera.position.x) - wall.at
    const cut = wall.room !== 0 && side * wall.room < 0
    full.current.visible = !cut
    low.current.visible = cut
  })
  // Local x runs along the wall; a 'z' wall is turned so local +x points to world +z.
  return <group position={wall.axis === 'x' ? [0, 0, wall.at] : [wall.at, 0, 0]} rotation={[0, wall.axis === 'x' ? 0 : -Math.PI / 2, 0]}>
    <group ref={full}>
      {pieces.map(([from, to]) => {
        const length = to - from, bays = Math.max(1, Math.round(length / 2.2))
        return <group key={from} position={[(from + to) / 2, 0, 0]}>
          <mesh position={[0, sill / 2, 0]} castShadow receiveShadow><boxGeometry args={[length, sill, thickness]}/><meshStandardMaterial color={colors.wall} roughness={.9}/></mesh>
          <mesh position={[0, sill + .02, 0]}><boxGeometry args={[length, .05, thickness + .03]}/><meshStandardMaterial color={colors.trim} roughness={.7}/></mesh>
          <mesh position={[0, (sill + height) / 2, 0]}><boxGeometry args={[length, height - sill, .04]}/><meshStandardMaterial color={colors.glass} transparent opacity={.16} depthWrite={false} roughness={.2}/></mesh>
          {Array.from({ length: bays + 1 }, (_, i) => <mesh key={i} position={[-length / 2 + .03 + i * (length - .06) / bays, (sill + height) / 2, 0]}>
            <boxGeometry args={[.06, height - sill, thickness]}/><meshStandardMaterial color={colors.trim} roughness={.7}/>
          </mesh>)}
        </group>
      })}
      {/* The top rail also runs over the doorways as their lintel. */}
      <mesh position={[(wall.from + wall.to) / 2, height, 0]}><boxGeometry args={[wall.to - wall.from, .1, thickness + .02]}/><meshStandardMaterial color={colors.trim} roughness={.7}/></mesh>
    </group>
    <group ref={low} visible={false}>
      {pieces.map(([from, to]) => <group key={from} position={[(from + to) / 2, 0, 0]}>
        <mesh position={[0, lowHeight / 2, 0]} castShadow receiveShadow><boxGeometry args={[to - from, lowHeight, thickness]}/><meshStandardMaterial color={colors.wall} roughness={.9}/></mesh>
        <mesh position={[0, lowHeight + .015, 0]}><boxGeometry args={[to - from, .04, thickness + .03]}/><meshStandardMaterial color={colors.trim} roughness={.7}/></mesh>
      </group>)}
    </group>
  </group>
}

export function OfficeWalls({ layout, theme }: { layout: OfficeLayout; theme: OfficePreferences['theme'] }) {
  const walls = useMemo(() => officeWalls(layout), [layout])
  return <group name="interior-walls">{walls.map(wall => <InteriorWall key={wall.key} wall={wall} theme={theme}/>)}</group>
}
