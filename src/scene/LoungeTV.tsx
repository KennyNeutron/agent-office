import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { CanvasTexture, SRGBColorSpace, type MeshBasicMaterial } from 'three'
import type { OfficeLayout } from './officeLayout'
import { tvWatched, type OfficeSimulation } from './officeSimulation'
import { TV } from './loungeLayout'

const refresh = (texture: CanvasTexture) => { texture.needsUpdate = true }

// A looping nature show: drifting clouds, a moving sun and scrolling hills.
function paintShow(context: CanvasRenderingContext2D, seconds: number) {
  const { width, height } = context.canvas
  const sky = context.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#5aa7e6'); sky.addColorStop(1, '#bfe4f6')
  context.fillStyle = sky
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#ffd86b'
  context.beginPath(); context.arc((seconds * 9) % (width + 60) - 30, 34, 16, 0, Math.PI * 2); context.fill()
  context.fillStyle = 'rgba(255,255,255,.9)'
  for (let i = 0; i < 3; i++) {
    const x = (i * 110 + seconds * (14 + i * 5)) % (width + 80) - 40, y = 22 + i * 15
    context.beginPath(); context.ellipse(x, y, 26, 8, 0, 0, Math.PI * 2); context.ellipse(x + 16, y - 5, 16, 8, 0, 0, Math.PI * 2); context.fill()
  }
  for (const [color, base, amplitude, speed, wave] of [['#6fb36a', 100, 14, 18, .028], ['#3f8f55', 116, 10, 32, .045]] as const) {
    context.fillStyle = color
    context.beginPath(); context.moveTo(0, height)
    for (let x = 0; x <= width; x += 6) context.lineTo(x, base + Math.sin((x + seconds * speed) * wave) * amplitude)
    context.lineTo(width, height); context.closePath(); context.fill()
  }
  // A bird gliding across.
  const bx = (seconds * 40) % (width + 40) - 20, by = 52 + Math.sin(seconds * 2) * 6
  context.strokeStyle = '#2b3446'; context.lineWidth = 2
  context.beginPath(); context.moveTo(bx - 7, by); context.quadraticCurveTo(bx - 3, by - 5, bx, by); context.quadraticCurveTo(bx + 3, by - 5, bx + 7, by); context.stroke()
}

/** Wall TV in the lounge. It switches on while an agent watches from the sofa. */
export function LoungeTV({ layout, simulation }: { layout: OfficeLayout; simulation: RefObject<OfficeSimulation> }) {
  const lounge = layout.amenities.find(item => item.id === 'meeting')
  const [texture] = useState(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 144
    const value = new CanvasTexture(canvas)
    value.colorSpace = SRGBColorSpace
    return value
  })
  useEffect(() => () => texture.dispose(), [texture])
  const screen = useRef<MeshBasicMaterial>(null)
  const led = useRef<MeshBasicMaterial>(null)
  const clock = useRef({ on: false, since: 0, painted: -1 })
  useFrame((state, delta) => {
    const on = tvWatched(simulation.current)
    const tv = clock.current
    if (on !== tv.on) { tv.on = on; tv.painted = -1 }
    tv.since += Math.min(delta, .1)
    if (screen.current) screen.current.color.set(on ? '#ffffff' : '#0b1220')
    if (led.current) led.current.color.set(on ? '#4ade80' : '#ef4444')
    // Repaint about 12 times a second while on; nothing to do while off.
    if (on && state.clock.elapsedTime - tv.painted > 1 / 12) {
      const context = (texture.image as HTMLCanvasElement).getContext('2d')
      if (context) { paintShow(context, tv.since); refresh(texture) }
      tv.painted = state.clock.elapsedTime
    }
  })
  if (!lounge) return null
  return <group position={[TV.wallX + .07 + TV.depth / 2, TV.y, lounge.z]} rotation={[0, Math.PI / 2, 0]} name="lounge-tv">
    <RoundedBox args={[TV.width + .1, TV.height + .1, TV.depth]} radius={.03} castShadow><meshStandardMaterial color="#121a26" roughness={.35} metalness={.3}/></RoundedBox>
    <mesh position={[0, 0, TV.depth / 2 + .002]}>
      <planeGeometry args={[TV.width, TV.height]}/>
      <meshBasicMaterial ref={screen} map={texture} color="#0b1220" toneMapped={false}/>
    </mesh>
    <mesh position={[TV.width / 2 - .04, -TV.height / 2 - .028, TV.depth / 2 + .003]}>
      <circleGeometry args={[.012, 10]}/><meshBasicMaterial ref={led} color="#ef4444" toneMapped={false}/>
    </mesh>
  </group>
}
