import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Color, Float32BufferAttribute, type Group, type LineBasicMaterial, type Mesh, type MeshStandardMaterial } from 'three'
import type { OfficeAgent } from '../types'
import type { OfficeLayout } from './officeLayout'
import { HOLOGRAM_HEIGHT, KNOWLEDGE_RADIUS, knowledgeGeometry, knowledgeGraphPosition, type KnowledgeReader } from './knowledgeGraphLayout'

const IDLE = new Color('#3f86d4')

/**
 * A holographic knowledge graph on a pedestal beside reception. Dim and slow while
 * nobody is querying it; nodes light up in the colours of agents reading it.
 */
export function KnowledgeGraph({ layout, readers, agents, accent, animate }: {
  layout: OfficeLayout; readers: KnowledgeReader[]; agents: OfficeAgent[]; accent: string; animate: boolean
}) {
  const [x, , z] = knowledgeGraphPosition(layout)
  const { nodes, edges } = useMemo(() => knowledgeGeometry(), [])
  const lines = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(edges.flatMap(([a, b]) => [...nodes[a], ...nodes[b]]), 3))
    return geometry
  }, [nodes, edges])
  useEffect(() => () => lines.dispose(), [lines])
  const colors = useMemo(() => readers.map(reader => new Color(agents.find(agent => agent.id === reader.agentId)?.color ?? accent)), [readers, agents, accent])
  const accentColor = useMemo(() => new Color(accent), [accent])
  const hologram = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const beam = useRef<Mesh>(null)
  const edgeMaterial = useRef<LineBasicMaterial>(null)
  const nodeMeshes = useRef<(Mesh | null)[]>([])
  const glow = useRef(0)
  useFrame((state, delta) => {
    const busy = colors.length > 0
    glow.current += ((busy ? 1 : 0) - glow.current) * Math.min(1, delta * 2.5)
    const g = glow.current, t = state.clock.elapsedTime
    if (hologram.current && animate) {
      hologram.current.rotation.y += delta * (.18 + g * .9)
      hologram.current.position.y = HOLOGRAM_HEIGHT + Math.sin(t * 1.1) * .03
    }
    nodeMeshes.current.forEach((mesh, i) => {
      if (!mesh) return
      const material = mesh.material as MeshStandardMaterial
      // Each reader owns every n-th node; the rest glow in the office accent.
      const owner = busy && i % (colors.length + 1) < colors.length ? colors[i % (colors.length + 1)] : null
      material.emissive.copy(IDLE).lerp(owner ?? accentColor, g)
      material.color.copy(material.emissive)
      const pulse = animate ? Math.sin(t * (2 + g * 3) + i * 1.7) * .5 + .5 : .5
      material.emissiveIntensity = .7 + g * (.5 + pulse * .9)
      mesh.scale.setScalar(1 + g * pulse * .4)
    })
    if (edgeMaterial.current) {
      edgeMaterial.current.color.copy(IDLE).lerp(colors[0] ?? accentColor, g)
      edgeMaterial.current.opacity = .55 + g * .4
    }
    if (core.current) {
      const material = core.current.material as MeshStandardMaterial
      material.emissive.copy(IDLE).lerp(colors[0] ?? accentColor, g)
      material.emissiveIntensity = .8 + g * 1.4
      if (animate) core.current.rotation.x += delta * .4
    }
    if (beam.current) (beam.current.material as MeshStandardMaterial).opacity = .06 + g * (.16 + (animate ? Math.sin(t * 4) * .05 : 0))
  })
  return <group position={[x, 0, z]} name="knowledge-graph">
    {/* Pedestal: weighted base, slim column and an emitter ring under the hologram. */}
    <mesh position={[0, .04, 0]} castShadow receiveShadow><cylinderGeometry args={[KNOWLEDGE_RADIUS, KNOWLEDGE_RADIUS + .02, .08, 28]}/><meshStandardMaterial color="#344257" metalness={.45} roughness={.45}/></mesh>
    <mesh position={[0, .55, 0]} castShadow><cylinderGeometry args={[.11, .15, .95, 18]}/><meshStandardMaterial color="#4b5d76" metalness={.5} roughness={.4}/></mesh>
    <RoundedBox position={[0, 1.05, 0]} args={[.5, .07, .5]} radius={.03} castShadow><meshStandardMaterial color="#26344a" metalness={.4} roughness={.4}/></RoundedBox>
    <mesh position={[0, 1.092, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.12, .2, 28]}/><meshBasicMaterial color={accent} toneMapped={false}/></mesh>
    <mesh ref={beam} position={[0, (1.1 + HOLOGRAM_HEIGHT) / 2, 0]}>
      <cylinderGeometry args={[.5, .2, HOLOGRAM_HEIGHT - 1.1, 24, 1, true]}/>
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={.6} transparent opacity={.06} depthWrite={false}/>
    </mesh>
    {/* Floating graph: nodes joined to their nearest neighbours, around a small core. */}
    <group ref={hologram} position={[0, HOLOGRAM_HEIGHT, 0]}>
      <mesh ref={core}><icosahedronGeometry args={[.1, 0]}/><meshStandardMaterial color="#c9d8ee" emissive={IDLE} emissiveIntensity={.8} flatShading/></mesh>
      <lineSegments geometry={lines}><lineBasicMaterial ref={edgeMaterial} color={IDLE} transparent opacity={.55} depthWrite={false}/></lineSegments>
      {nodes.map((position, i) => <mesh key={i} ref={mesh => { nodeMeshes.current[i] = mesh }} position={position}>
        <sphereGeometry args={[i % 5 === 0 ? .055 : .038, 12, 10]}/>
        <meshStandardMaterial color={IDLE} emissive={IDLE} emissiveIntensity={.7} roughness={.3}/>
      </mesh>)}
    </group>
  </group>
}
