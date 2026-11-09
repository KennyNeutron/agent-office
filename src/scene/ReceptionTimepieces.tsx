import { RoundedBox } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'
import { calendarText, clockText, DESK_CLOCK, WALL_CALENDAR } from './timepieceLayout'

const FONT = "'DM Sans', system-ui, sans-serif"
const refresh = (texture: CanvasTexture) => { texture.needsUpdate = true }

// Draws onto a 2D canvas used as a texture: crisp text with no font download.
function useLiveTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D, now: Date, tick: number) => void, intervalMs: number) {
  const [texture] = useState(() => {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const value = new CanvasTexture(canvas)
    value.colorSpace = SRGBColorSpace
    value.anisotropy = 4
    return value
  })
  const paint = useRef(draw)
  useEffect(() => { paint.current = draw })
  useEffect(() => {
    const context = (texture.image as HTMLCanvasElement).getContext('2d')
    if (!context) return
    let tick = 0
    const render = () => { paint.current(context, new Date(), tick++); refresh(texture) }
    render()
    // Web fonts can finish loading after the first paint.
    void document.fonts?.ready.then(render)
    const timer = window.setInterval(render, intervalMs)
    return () => window.clearInterval(timer)
  }, [texture, intervalMs])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

/** A small LED desk clock showing local 24-hour time. The colon blinks unless motion is reduced. */
export function DeskClock({ animate }: { animate: boolean }) {
  const face = useLiveTexture(256, 112, (context, now, tick) => {
    const { width, height } = context.canvas
    context.fillStyle = '#071019'
    context.fillRect(0, 0, width, height)
    const [hours, minutes] = clockText(now).split(':')
    context.font = `700 82px ui-monospace, 'SFMono-Regular', Menlo, monospace`
    context.textBaseline = 'middle'
    context.textAlign = 'center'
    context.shadowColor = '#43f0b0'
    context.shadowBlur = 14
    context.fillStyle = '#5dfcc0'
    context.fillText(hours, width / 2 - 62, height / 2 + 4)
    context.fillText(minutes, width / 2 + 62, height / 2 + 4)
    context.fillStyle = !animate || tick % 2 === 0 ? '#5dfcc0' : '#13342b'
    context.fillText(':', width / 2, height / 2)
  }, 1000)
  const { x, y, z, width, height, depth, rotationY } = DESK_CLOCK
  return <group position={[x, y, z]} rotation={[0, rotationY, 0]} name="desk-clock">
    <RoundedBox args={[width, height, depth]} radius={.03} castShadow><meshStandardMaterial color="#2b3443" roughness={.45} metalness={.25}/></RoundedBox>
    {/* Upright and just proud of the front face, so the body never covers the digits. */}
    <mesh position={[0, 0, depth / 2 + .003]}>
      <planeGeometry args={[width - .05, height - .05]}/>
      <meshBasicMaterial map={face} toneMapped={false}/>
    </mesh>
    {[-1, 1].map(side => <mesh key={side} position={[side * (width / 2 - .06), -height / 2 - .008, 0]}>
      <boxGeometry args={[.05, .016, depth - .02]}/><meshStandardMaterial color="#1b222c"/>
    </mesh>)}
  </group>
}

/** A tear-off wall calendar showing only today's month, date and weekday. */
export function WallCalendar({ accent }: { accent: string }) {
  const page = useLiveTexture(240, 288, (context, now) => {
    const { width, height } = context.canvas
    const { month, day, weekday } = calendarText(now)
    context.fillStyle = '#fbfaf6'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#d9474f'
    context.fillRect(0, 0, width, 70)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#ffffff'
    context.font = `800 34px ${FONT}`
    context.fillText(month, width / 2, 37)
    context.fillStyle = '#1e2635'
    context.font = `800 124px ${FONT}`
    context.fillText(day, width / 2, 152)
    context.fillStyle = '#3d4859'
    context.font = `800 40px ${FONT}`
    context.fillText(weekday, width / 2, 246, width - 20)
  }, 60_000)
  const { x, y, z, width, height, depth } = WALL_CALENDAR
  return <group position={[x, y, z]} name="wall-calendar">
    <mesh><boxGeometry args={[width, height, depth]}/><meshStandardMaterial color="#e8e4da" roughness={.9}/></mesh>
    <mesh position={[0, 0, depth / 2 + .002]}><planeGeometry args={[width - .03, height - .03]}/><meshBasicMaterial map={page} toneMapped={false}/></mesh>
    {/* Binding rings along the top edge. */}
    {[-.2, -.07, .07, .2].map(offset => <mesh key={offset} position={[offset, height / 2 - .01, depth / 2 + .012]} rotation={[0, Math.PI / 2, 0]}>
      <torusGeometry args={[.022, .006, 6, 14]}/><meshStandardMaterial color={accent} metalness={.6} roughness={.35}/>
    </mesh>)}
  </group>
}
