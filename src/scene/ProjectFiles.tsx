import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import type { Group } from 'three'
import type { OfficeLayout } from './officeLayout'
import { PROJECT_FILES, PROJECT_HOLOGRAM_HEIGHT, projectFilesPosition } from './projectFilesLayout'

const FOLDERS = ['#f2c14e', '#7fb6e8', '#8fd6a8', '#f29b8f']

/**
 * The office project, as a file organizer on the reception counter with a
 * floating folder above it. Clicking either opens the project folder dialog.
 */
export function ProjectFiles({ layout, accent, animate, onOpen }: { layout: OfficeLayout; accent: string; animate: boolean; onOpen: () => void }) {
  const [hovered, setHovered] = useState(false)
  const hologram = useRef<Group>(null)
  const glow = useRef<{ emissiveIntensity: number } | null>(null)
  const [x, y, z] = projectFilesPosition(layout)
  useFrame(state => {
    const t = state.clock.elapsedTime
    if (hologram.current) {
      hologram.current.position.y = PROJECT_HOLOGRAM_HEIGHT + (animate ? Math.sin(t * 1.4) * .035 : 0)
      hologram.current.rotation.y = animate ? Math.sin(t * .6) * .35 : 0
    }
    if (glow.current) glow.current.emissiveIntensity = (hovered ? 1.1 : .55) + (animate ? Math.sin(t * 2.2) * .12 : 0)
  })
  const { width, depth, height } = PROJECT_FILES
  return <group position={[x, y, z]} name="project-files"
    onClick={event => { event.stopPropagation(); onOpen() }}
    onPointerOver={event => { event.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}>
    {/* Open-top organizer: base plus four walls, so the folders visibly stand inside. */}
    <RoundedBox position={[0, .012, 0]} args={[width, .024, depth]} radius={.008} castShadow><meshStandardMaterial color="#3d4c63" roughness={.6}/></RoundedBox>
    {[-1, 1].map(side => <mesh key={`wall-x-${side}`} position={[side * (width / 2 - .01), height / 2, 0]} castShadow>
      <boxGeometry args={[.02, height, depth]}/><meshStandardMaterial color="#4a5b75" roughness={.6}/>
    </mesh>)}
    <mesh position={[0, height * .35, depth / 2 - .01]}><boxGeometry args={[width, height * .7, .02]}/><meshStandardMaterial color={hovered ? accent : '#4a5b75'} roughness={.6}/></mesh>
    <mesh position={[0, height / 2, -depth / 2 + .01]}><boxGeometry args={[width, height, .02]}/><meshStandardMaterial color="#4a5b75" roughness={.6}/></mesh>
    {/* Hanging folders, each with a tab, leaning slightly back. */}
    {FOLDERS.map((color, index) => <group key={color} position={[-width / 2 + .07 + index * .1, .02, -.01]} rotation={[0, 0, (index - 1.5) * .04]}>
      <mesh position={[0, .13, 0]} rotation={[0, Math.PI / 2, 0]} castShadow><boxGeometry args={[depth - .06, .24, .012]}/><meshStandardMaterial color={color} roughness={.8}/></mesh>
      <mesh position={[0, .265, -.06 + index * .03]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[.07, .035, .012]}/><meshStandardMaterial color={color} roughness={.8}/></mesh>
    </group>)}
    {/* Floating folder hologram in the office accent colour. */}
    <group ref={hologram} position={[0, PROJECT_HOLOGRAM_HEIGHT, 0]}>
      <mesh position={[0, 0, 0]}><boxGeometry args={[.3, .2, .02]}/>
        <meshStandardMaterial ref={material => { glow.current = material }} color={accent} emissive={accent} emissiveIntensity={.55} transparent opacity={.82} roughness={.3}/></mesh>
      <mesh position={[-.075, .115, 0]}><boxGeometry args={[.13, .04, .02]}/><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={.5} transparent opacity={.82}/></mesh>
      <mesh position={[0, -.02, .012]}><planeGeometry args={[.2, .018]}/><meshBasicMaterial color="#ffffff" transparent opacity={.85}/></mesh>
      <mesh position={[0, -.055, .012]}><planeGeometry args={[.14, .018]}/><meshBasicMaterial color="#ffffff" transparent opacity={.6}/></mesh>
    </group>
    {/* Soft light cone joining the hologram to the organizer. */}
    <mesh position={[0, (height + PROJECT_HOLOGRAM_HEIGHT - .12) / 2 + .04, 0]}>
      <cylinderGeometry args={[.05, .17, PROJECT_HOLOGRAM_HEIGHT - height - .08, 16, 1, true]}/>
      <meshBasicMaterial color={accent} transparent opacity={hovered ? .2 : .1} depthWrite={false}/>
    </mesh>
  </group>
}
