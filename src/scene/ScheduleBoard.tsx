import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import type { Group } from 'three'
import type { OfficeAgent, OfficeSchedule } from '../types'
import type { OfficeLayout } from './officeLayout'
import { BOARD_ROTATION, scheduleBoardPosition } from './scheduleBoardLayout'

const ROWS = 4

function Clock() {
  const hour = useRef<Group>(null)
  const minute = useRef<Group>(null)
  useFrame(() => {
    const now = new Date()
    const minutes = now.getMinutes() + now.getSeconds() / 60
    if (minute.current) minute.current.rotation.z = -minutes / 60 * Math.PI * 2
    if (hour.current) hour.current.rotation.z = -((now.getHours() % 12) + minutes / 60) / 12 * Math.PI * 2
  })
  return <group position={[0, 2.43, .02]}>
    <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.25, .25, .06, 32]}/><meshStandardMaterial color="#2a3a52" metalness={.3}/></mesh>
    <mesh position={[0, 0, .032]}><circleGeometry args={[.215, 32]}/><meshStandardMaterial color="#f6f8fb" roughness={.6}/></mesh>
    {Array.from({ length: 12 }, (_, i) => <mesh key={i} position={[Math.sin(i / 12 * Math.PI * 2) * .18, Math.cos(i / 12 * Math.PI * 2) * .18, .036]}>
      <circleGeometry args={[i % 3 ? .009 : .017, 8]}/><meshBasicMaterial color="#3a4a62"/>
    </mesh>)}
    <group ref={hour} position={[0, 0, .04]}><mesh position={[0, .05, 0]}><boxGeometry args={[.022, .11, .006]}/><meshBasicMaterial color="#26334a"/></mesh></group>
    <group ref={minute} position={[0, 0, .045]}><mesh position={[0, .075, 0]}><boxGeometry args={[.014, .16, .006]}/><meshBasicMaterial color="#26334a"/></mesh></group>
    <mesh position={[0, 0, .05]}><circleGeometry args={[.018, 12]}/><meshBasicMaterial color="#e2566b"/></mesh>
  </group>
}

/** A free-standing digital schedule board. Each lit row is one upcoming scheduled task. */
export function ScheduleBoard({ layout, schedules, agents, accent, onOpen }: {
  layout: OfficeLayout; schedules: OfficeSchedule[]; agents: OfficeAgent[]; accent: string; onOpen: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const screen = useRef<{ emissiveIntensity: number } | null>(null)
  const [x, , z] = scheduleBoardPosition(layout)
  const upcoming = schedules.filter(item => item.enabled && item.nextRunAt)
    .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!)).slice(0, ROWS)
  const waiting = new Set(schedules.filter(item => item.lastStatus === 'waiting' && item.enabled).map(item => item.id))
  useFrame(state => {
    if (screen.current) screen.current.emissiveIntensity = (hovered ? .55 : .32) + Math.sin(state.clock.elapsedTime * 1.6) * .04
  })
  return <group position={[x, 0, z]} rotation={[0, BOARD_ROTATION, 0]} name="schedule-board"
    onClick={event => { event.stopPropagation(); onOpen() }}
    onPointerOver={event => { event.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}>
    {/* Weighted feet and two posts keep the board grounded. */}
    {[-.68, .68].map(side => <group key={side} position={[side, 0, 0]}>
      <RoundedBox position={[0, .03, 0]} args={[.16, .06, .62]} radius={.02} castShadow><meshStandardMaterial color="#3b4a60" metalness={.4}/></RoundedBox>
      <mesh position={[0, .55, 0]} castShadow><cylinderGeometry args={[.035, .035, 1.05, 10]}/><meshStandardMaterial color="#6f7d91" metalness={.55} roughness={.4}/></mesh>
    </group>)}
    <RoundedBox position={[0, 1.6, 0]} args={[1.68, 1.12, .1]} radius={.04} castShadow>
      <meshStandardMaterial color={hovered ? '#24364f' : '#1b2638'} roughness={.5}/>
    </RoundedBox>
    <mesh position={[0, 1.6, .052]}>
      <planeGeometry args={[1.54, .98]}/>
      <meshStandardMaterial ref={material => { screen.current = material }} color="#0d1b2e" emissive="#16304d" emissiveIntensity={.32} roughness={.35}/>
    </mesh>
    {/* Header strip in the office accent colour, with a calendar glyph. */}
    <mesh position={[0, 2.0, .055]}><planeGeometry args={[1.54, .17]}/><meshBasicMaterial color={accent}/></mesh>
    <group position={[-.64, 2.0, .058]}>
      <mesh><planeGeometry args={[.12, .1]}/><meshBasicMaterial color="#ffffff"/></mesh>
      <mesh position={[0, .035, .001]}><planeGeometry args={[.12, .03]}/><meshBasicMaterial color="#e2566b"/></mesh>
    </group>
    {[0, 1, 2].map(i => <mesh key={i} position={[-.38 + i * .2, 2.0, .058]}><planeGeometry args={[.15, .028]}/><meshBasicMaterial color="#ffffff" transparent opacity={.85}/></mesh>)}
    {Array.from({ length: ROWS }, (_, row) => {
      const schedule = upcoming[row]
      const color = schedule ? agents.find(agent => agent.id === schedule.agentId)?.color ?? '#9ba9c2' : '#2a3c55'
      const y = 1.8 - row * .2
      return <group key={row} position={[0, y, .058]}>
        <mesh position={[-.64, 0, 0]}><planeGeometry args={[.12, .12]}/><meshBasicMaterial color={color}/></mesh>
        <mesh position={[-.18, 0, 0]}><planeGeometry args={[schedule ? .66 : .5, .045]}/><meshBasicMaterial color={schedule ? '#a8bfd8' : '#243650'}/></mesh>
        <mesh position={[.48, 0, 0]}><planeGeometry args={[.36, .1]}/><meshBasicMaterial color={schedule ? (waiting.has(schedule.id) ? '#f5b85f' : '#62d6a0') : '#1d2e45'}/></mesh>
      </group>
    })}
    <Clock/>
  </group>
}
