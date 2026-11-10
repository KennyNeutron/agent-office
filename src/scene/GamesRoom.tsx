import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { CanvasTexture, SRGBColorSpace, type Mesh } from 'three'
import type { OfficeLayout } from './officeLayout'
import type { OfficePreferences } from './officePreferences'
import { playersAt, type OfficeSimulation } from './officeSimulation'
import { GAMES, gamesRoom } from './loungeLayout'

// Concentric dartboard rings, outermost first: [radius, colour].
const DART_RINGS: [number, string][] = [[.25, '#1b1f27'], [.225, '#d23b3b'], [.215, '#efe3c4'], [.15, '#2f8f55'], [.14, '#1b1f27'], [.03, '#2f8f55'], [.014, '#d23b3b']]

function Dartboard({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0, z]}>
    {/* Free-standing partition with a cork surround; the board faces east. */}
    <RoundedBox position={[-.06, 1.15, 0]} args={[.12, 2.3, 1.8]} radius={.03} castShadow><meshStandardMaterial color="#cdd8df" roughness={.85}/></RoundedBox>
    <mesh position={[.005, 1.73, 0]} rotation={[0, Math.PI / 2, 0]}><circleGeometry args={[.42, 32]}/><meshStandardMaterial color="#b98b5e" roughness={.95}/></mesh>
    {DART_RINGS.map(([radius, color], index) => <mesh key={index} position={[.012 + index * .002, 1.73, 0]} rotation={[0, Math.PI / 2, 0]}>
      <circleGeometry args={[radius, 32]}/><meshStandardMaterial color={color} roughness={.8}/>
    </mesh>)}
    {[[.05, .06], [-.08, -.03], [.02, -.11]].map(([dz, dy], index) => <group key={index} position={[.06, 1.73 + dy, dz]} rotation={[0, 0, -Math.PI / 2]}>
      <mesh><cylinderGeometry args={[.006, .006, .1, 6]}/><meshStandardMaterial color="#c9ced6" metalness={.7}/></mesh>
      <mesh position={[0, -.055, 0]}><boxGeometry args={[.035, .03, .002]}/><meshStandardMaterial color={['#e2566b', '#4c9be8', '#f5b85f'][index]}/></mesh>
    </group>)}
    {/* Throw line on the floor. */}
    <mesh position={[GAMES.dartsThrow - .23, .006, 0]}><boxGeometry args={[.05, .006, .9]}/><meshStandardMaterial color="#e2566b"/></mesh>
  </group>
}

function PingPongTable({ x, z }: { x: number; z: number }) {
  const { length, width, height } = GAMES.table
  return <group position={[x, 0, z]}>
    <mesh position={[0, height - .02, 0]} castShadow receiveShadow><boxGeometry args={[length, .04, width]}/><meshStandardMaterial color="#1f5f8b" roughness={.6}/></mesh>
    {/* White edge and centre lines. */}
    {[-1, 1].map(side => <mesh key={`edge-${side}`} position={[0, height + .001, side * (width / 2 - .01)]}><boxGeometry args={[length, .002, .02]}/><meshBasicMaterial color="#f4f7fb"/></mesh>)}
    {[-1, 1].map(side => <mesh key={`end-${side}`} position={[side * (length / 2 - .01), height + .001, 0]}><boxGeometry args={[.02, .002, width]}/><meshBasicMaterial color="#f4f7fb"/></mesh>)}
    <mesh position={[0, height + .001, 0]}><boxGeometry args={[length, .002, .006]}/><meshBasicMaterial color="#f4f7fb"/></mesh>
    {/* Net with posts. */}
    <mesh position={[0, height + .08, 0]}><boxGeometry args={[.01, .15, width + .1]}/><meshStandardMaterial color="#e8edf2" transparent opacity={.75}/></mesh>
    <mesh position={[0, height + .155, 0]}><boxGeometry args={[.014, .012, width + .1]}/><meshBasicMaterial color="#ffffff"/></mesh>
    {[-1, 1].map(side => <mesh key={`post-${side}`} position={[0, height + .08, side * (width / 2 + .06)]}><cylinderGeometry args={[.012, .012, .17, 6]}/><meshStandardMaterial color="#3b4656"/></mesh>)}
    {[-1, 1].map(sx => [-1, 1].map(sz => <mesh key={`${sx}${sz}`} position={[sx * (length / 2 - .25), (height - .04) / 2, sz * (width / 2 - .15)]}>
      <boxGeometry args={[.05, height - .04, .05]}/><meshStandardMaterial color="#3b4656" metalness={.4}/>
    </mesh>))}
  </group>
}

function ChessTable({ x, z }: { x: number; z: number }) {
  const [board] = useState(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')
    if (context) for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      context.fillStyle = (row + col) % 2 ? '#7b5537' : '#eed9b4'
      context.fillRect(col * 16, row * 16, 16, 16)
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
  })
  useEffect(() => () => board.dispose(), [board])
  const { size, height } = GAMES.chessTable
  const square = .48 / 8
  // A game in progress: a few pieces on each side.
  const pieces: [number, number, string, number][] = [[0, 1, '#f3efe6', .07], [2, 1, '#f3efe6', .07], [3, 2, '#f3efe6', .07], [4, 0, '#f3efe6', .12], [5, 1, '#f3efe6', .07],
    [1, 6, '#2a2e36', .07], [3, 5, '#2a2e36', .07], [4, 7, '#2a2e36', .12], [6, 6, '#2a2e36', .07], [5, 4, '#2a2e36', .09]]
  return <group position={[x, 0, z]}>
    <RoundedBox position={[0, height - .03, 0]} args={[size, .06, size]} radius={.02} castShadow><meshStandardMaterial color="#c9b293" roughness={.7}/></RoundedBox>
    <mesh position={[0, (height - .06) / 2, 0]}><cylinderGeometry args={[.06, .08, height - .06, 10]}/><meshStandardMaterial color="#5f6f82" metalness={.4}/></mesh>
    <mesh position={[0, .02, 0]}><cylinderGeometry args={[.3, .32, .04, 18]}/><meshStandardMaterial color="#4b5869"/></mesh>
    <mesh position={[0, height + .002, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[.48, .48]}/><meshStandardMaterial map={board} roughness={.6}/></mesh>
    {pieces.map(([file, rank, color, tall], index) => <mesh key={index} position={[(rank - 3.5) * square, height + tall / 2, (file - 3.5) * square]} castShadow>
      <cylinderGeometry args={[.012, .018, tall, 8]}/><meshStandardMaterial color={color} roughness={.5}/>
    </mesh>)}
    {/* Two chairs facing each other; seat tops match the desk chairs. */}
    {[-1, 1].map(side => <group key={side} position={[side * GAMES.chessSeat, 0, 0]}>
      <RoundedBox position={[0, .65, 0]} args={[.78, .13, .78]} radius={.11} castShadow><meshStandardMaterial color="#4b6079" roughness={.78}/></RoundedBox>
      <RoundedBox position={[side * .42, 1.03, 0]} args={[.12, .72, .82]} radius={.1} castShadow><meshStandardMaterial color="#536c89" roughness={.82}/></RoundedBox>
      <mesh position={[0, .32, 0]}><cylinderGeometry args={[.06, .08, .58, 10]}/><meshStandardMaterial color="#58667b" metalness={.4}/></mesh>
      <mesh position={[0, .05, 0]}><cylinderGeometry args={[.3, .32, .06, 14]}/><meshStandardMaterial color="#39465d"/></mesh>
    </group>)}
  </group>
}

/** Static games room furniture along the south strip of the floor. */
export function GamesRoom({ layout, preferences }: { layout: OfficeLayout; preferences: OfficePreferences }) {
  const room = gamesRoom(layout)
  if (!room) return null
  const floor = preferences.theme === 'midnight' ? '#33485c' : preferences.theme === 'warm' ? '#e6d3c1' : '#dbe6ee'
  const length = layout.width - 1.2
  return <group name="games-room">
    <mesh position={[layout.width / 2, .004, room.rowZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[length, 3.4]}/><meshStandardMaterial color={floor} roughness={.95}/>
    </mesh>
    <mesh position={[layout.width / 2, .006, room.rowZ - 1.7]}><boxGeometry args={[length, .006, .05]}/><meshStandardMaterial color={preferences.accent}/></mesh>
    <Dartboard x={room.dartsBoardX} z={room.rowZ}/>
    <PingPongTable x={room.tableX} z={room.rowZ}/>
    <ChessTable x={room.chessX} z={room.rowZ}/>
  </group>
}

/**
 * The table tennis ball: rallies between two players, or bounces on one side
 * while a single player practises. Hidden when nobody is playing.
 */
export function PingPongBall({ layout, simulation }: { layout: OfficeLayout; simulation: RefObject<OfficeSimulation> }) {
  const ball = useRef<Mesh>(null)
  const time = useRef(0)
  const room = gamesRoom(layout)
  useFrame((_, delta) => {
    if (!ball.current || !room) return
    const players = playersAt(simulation.current, 'pingpong')
    ball.current.visible = players.size > 0
    if (!players.size) return
    time.current += Math.min(delta, .05)
    const { length, height } = GAMES.table
    const reach = length / 2 + .35
    if (players.size === 2) {
      // One leg per .9 s: paddle, bounce on the far half, next paddle.
      const leg = time.current / .9, forward = Math.floor(leg) % 2 === 0, p = leg % 1
      const from = forward ? -reach : reach, to = -from
      ball.current.position.set(room.tableX + from + (to - from) * p, height + .32 + Math.abs(Math.sin(p * Math.PI * 2)) * .32 - p * .1, room.rowZ + Math.sin(leg * 1.7) * .25)
    } else {
      const side = players.has('pingpong-0') ? -1 : 1
      const p = (time.current / .7) % 1
      ball.current.position.set(room.tableX + side * (length / 2 - .35), height + .03 + Math.sin(p * Math.PI) * .45, room.rowZ + .1)
    }
  })
  if (!room) return null
  return <mesh ref={ball} visible={false} castShadow><sphereGeometry args={[.025, 10, 8]}/><meshStandardMaterial color="#ffffff" emissive="#fff4d6" emissiveIntensity={.3}/></mesh>
}
