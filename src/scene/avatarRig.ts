// Character space always faces +Z. Workstations rotate the whole character
// toward -Z, where the desk and monitor are located. The same connected joints
// are used for standing, walking, typing and the complete sitting transition.
export type RigPoint = [number, number, number]
type Arm = { shoulder: RigPoint; elbow: RigPoint; wrist: RigPoint }
type Leg = { hip: RigPoint; knee: RigPoint; ankle: RigPoint; foot: RigPoint }
export type AvatarRigPose = {
  torsoDrop: number
  headPitch: number
  headRoll: number
  bob: number
  shoePitch: [number, number]
  arms: [Arm, Arm]
  legs: [Leg, Leg]
}

/** Blend amounts (0..1) for ambient idle poses. Presentation only, never task state. */
export type IdleBlend = { browse?: number; lap?: number; stretch?: number; phone?: number; look?: number; darts?: number; pingpong?: number; chess?: number }
export type IdlePose = keyof IdleBlend

const mix = (a: RigPoint, b: RigPoint, amount: number): RigPoint =>
  [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
const clamp01 = (value = 0) => Math.max(0, Math.min(1, value))
/** Point `from` + unit(direction) * length. */
const along = (from: RigPoint, direction: RigPoint, length: number): RigPoint => {
  const size = Math.hypot(...direction) || 1
  return [from[0] + direction[0] / size * length, from[1] + direction[1] / size * length, from[2] + direction[2] / size * length]
}
const minus = (a: RigPoint, b: RigPoint): RigPoint => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
/**
 * Blend an arm toward a target pose by bone direction and bone length rather
 * than joint position, so neither bone shrinks while the pose changes.
 */
function blendArm(arm: { shoulder: RigPoint; elbow: RigPoint; wrist: RigPoint }, elbow: RigPoint, wrist: RigPoint, amount: number) {
  if (amount <= 0) return
  const upperFrom = minus(arm.elbow, arm.shoulder), upperTo = minus(elbow, arm.shoulder)
  const foreFrom = minus(arm.wrist, arm.elbow), foreTo = minus(wrist, elbow)
  const upperLength = Math.hypot(...upperFrom) + (Math.hypot(...upperTo) - Math.hypot(...upperFrom)) * amount
  const foreLength = Math.hypot(...foreFrom) + (Math.hypot(...foreTo) - Math.hypot(...foreFrom)) * amount
  arm.elbow = along(arm.shoulder, mix(upperFrom, upperTo, amount), upperLength)
  arm.wrist = along(arm.elbow, mix(foreFrom, foreTo, amount), foreLength)
}

export function makeAvatarRigPose(seatedInput: number, walking: boolean | number, seconds: number,
  activity: 'idle' | 'thinking' | 'coding' | 'researching' | 'finishing' | 'celebrating' | 'error',
  thinkingProgress = activity === 'thinking' ? 1 : 0, gaitPhase = seconds * 9, coffeeProgress = 0, coffeeSeconds = seconds, idle: IdleBlend = {}): AvatarRigPose {
  // Ease the body into and out of the chair so the hips and torso do not
  // stop or start at full speed. All joints share this same transition.
  const seatProgress = Math.max(0, Math.min(1, seatedInput))
  const seated = seatProgress * seatProgress * (3 - 2 * seatProgress)
  const stride = (typeof walking === 'boolean' ? Number(walking) : Math.max(0, Math.min(1, walking))) * (1 - seated)
  const typing = seated > .94 && activity === 'coding'
  // Chess: alternate between pondering (hand to chin) and hands back on the table to move a piece.
  const ponder = Math.max(0, Math.min(1, idle.chess ?? 0)) * Math.max(0, Math.min(1, Math.sin(seconds * .55) * 1.6 + .3))
  const thinking = seated * Math.max(Math.max(0, Math.min(1, thinkingProgress)), ponder)
  const coffee = Math.max(0, Math.min(1, coffeeProgress)) * (1 - seated) * (1 - stride)
  const sip = .5 - .5 * Math.cos(coffeeSeconds * 1.35)
  const arms = [-1, 1].map(side => {
    const phase = Math.sin(gaitPhase + (side === 1 ? Math.PI : 0)) * stride
    // The workstation faces -Z, so its local +X mouse is on the avatar's -X.
    // The mouse is on the worker's left after the workstation's 180 degree
    // rotation. Neither seated hand needs to extend an entire metre.
    const wristX = side === -1 ? -.4 - seated * .19 : .4 - seated * .14
    const contemplation = side === 1 ? thinking : 0
    // Bring the free hand to the chin while thinking. The other hand stays on
    // the mouse, and the forearm remains connected to its moving elbow.
    const baseWristY = 1.02 + seated * .065
    const baseWristZ = .12 + seated * .66 + phase * .2
    const coffeeAmount = side === 1 ? coffee : 0
    const elbowY = 1.28 - seated * .24 + contemplation * .16
    const elbowZ = .025 + seated * .43 - phase * .08 + contemplation * .07
    const wristY = baseWristY + contemplation * (1.50 - baseWristY) + (typing && side === 1 ? Math.sin(seconds * 12) * .016 : 0)
    const wristZ = baseWristZ + contemplation * (.27 - baseWristZ) + (typing && side === 1 ? Math.cos(seconds * 12) * .014 : 0)
    return {
      // The shoulders and pelvis descend together as a single body when the
      // character sits. The forearms then reach the fixed desktop height.
      shoulder: [side * .37, 1.66 - seated * .4, -.02] as RigPoint,
      elbow: [side * (.44 + seated * .06) - contemplation * .04,
        elbowY + coffeeAmount * (1.43 - elbowY),
        elbowZ + coffeeAmount * (.20 - elbowZ)] as RigPoint,
      wrist: [wristX - contemplation * .26 + coffeeAmount * (.34 - sip * .25 - wristX + contemplation * .26),
        wristY + coffeeAmount * (1.34 + sip * .395 - wristY),
        wristZ + coffeeAmount * (.31 - sip * .15 - wristZ)] as RigPoint,
    }
  }) as [Arm, Arm]
  // Ambient idle poses blend over the base arms. Each keeps the upper arm and
  // forearm close to their normal lengths so limbs never visibly stretch.
  const browse = clamp01(idle.browse) * seated, lap = clamp01(idle.lap) * seated
  const standing = (1 - seated) * (1 - stride)
  // Stretch: raise both arms overhead, hold, lower, repeat.
  const stretchCycle = .5 - .5 * Math.cos(seconds * 1.25)
  const stretch = clamp01(idle.stretch) * standing * stretchCycle * stretchCycle * (3 - 2 * stretchCycle)
  const phone = clamp01(idle.phone) * standing, look = clamp01(idle.look) * standing
  const darts = clamp01(idle.darts) * standing, pingpong = clamp01(idle.pingpong) * standing
  arms.forEach((arm, index) => {
    const side = index === 0 ? -1 : 1
    if (browse) {
      // The mouse hand drifts slowly while reading the screen; no typing.
      if (side === -1) arm.wrist = [arm.wrist[0] + Math.sin(seconds * 1.3) * .035 * browse, arm.wrist[1], arm.wrist[2] + Math.sin(seconds * .9) * .03 * browse]
    }
    if (lap) blendArm(arm, [side * .46, .97, .04], [side * .25, .93, .32], lap)
    if (stretch) {
      // Swing each arm up in an arc around the shoulder (down, out to the side,
      // overhead) so the upper arm keeps its length through the whole motion.
      const angle = stretch * Math.PI, lateral = Math.sin(angle)
      const elbow: RigPoint = [arm.shoulder[0] + side * lateral * .34, arm.shoulder[1] - Math.cos(angle) * .36, arm.shoulder[2] - .03 * stretch]
      const inward = .5 * stretch
      const reach = Math.hypot(lateral * .85 - inward, Math.cos(angle)) || 1
      const wrist: RigPoint = [elbow[0] + side * (lateral * .85 - inward) / reach * .36, elbow[1] - Math.cos(angle) / reach * .36, elbow[2] + .03]
      blendArm(arm, elbow, wrist, Math.min(1, stretch * 6))
    }
    if (phone) blendArm(arm, [side * .4, 1.31, .07], side === 1 ? [.1, 1.32, .37] : [-.07, 1.29, .36], phone)
    if (darts && side === 1) {
      // Aim with the dart beside the face, then a quick forward release.
      const cycle = (seconds * .7) % 1
      const release = cycle < .7 ? 0 : Math.sin((cycle - .7) / .3 * Math.PI)
      const elbow = mix([.33, 1.6, .26], [.33, 1.66, .34], release)
      const wrist = mix([.22, 1.86, .12], [.27, 1.86, .66], release)
      blendArm(arm, elbow, wrist, darts)
    }
    if (pingpong) {
      // Ready stance: paddle hand forward, swinging across the body; free hand out for balance.
      const swing = Math.sin(seconds * 3.1)
      if (side === 1) blendArm(arm, [.44, 1.34, .2], [.3 + swing * .17, 1.27 + Math.abs(swing) * .05, .46], pingpong)
      else blendArm(arm, [-.43, 1.33, .12], [-.33, 1.22, .4], pingpong)
    }
    if (look && side === 1) {
      // Hand to the chin while reading the schedule.
      blendArm(arm, [.38, 1.24, .19], [.12, 1.5, .28], look)
    }
  })
  const shoePitch: [number, number] = [0, 0]
  const legs = [-1, 1].map((side, index) => {
    const phase = gaitPhase + (side === 1 ? Math.PI : 0)
    const step = Math.sin(phase)
    // Feet stay on the ground during the support phase. Only the swinging
    // leg lifts, using a smooth arc tied to actual distance traveled.
    const lift = Math.pow(Math.max(0, step), 1.5) * .105 * stride
    const footZ = .11 - Math.cos(phase) * .145 * stride
    // The ankle sits INSIDE the shoe collar instead of behind the heel. The
    // standing pelvis is high enough for nearly straight legs, while the
    // seated pelvis drops to the chair cushion without detaching the thigh.
    // The shoe bottom is ~.073 below its origin; .078 keeps the outsole on
    // the floor. The ankle meets the collar exactly .105 above the shoe.
    const ankle: RigPoint = [side * .17, .183 + lift, (footZ - .075) * (1 - seated) + .60 * seated]
    const hip: RigPoint = [side * .165, 1.16 - seated * .4, -.04]
    // Solve the same two fixed-length bones for standing, walking and sitting.
    // Interpolating an arbitrary seated knee used to stretch the limbs.
    const dy = ankle[1] - hip[1], dz = ankle[2] - hip[2]
    const distance = Math.max(.0001, Math.hypot(dy, dz))
    const femur = .51, shin = .50
    const along = (femur * femur - shin * shin + distance * distance) / (2 * distance)
    const reach = Math.sqrt(Math.max(0, femur * femur - along * along))
    const normalY = -dz / distance, normalZ = dy / distance
    const walkingKnee: RigPoint = [side * .17,
      hip[1] + dy / distance * along - normalY * reach,
      hip[2] + dz / distance * along - normalZ * reach]
    // Settle the shoe before and after walking; keep the toe down in the
    // support phase rather than spinning the entire limb on every frame.
    // Only swing-phase shoes pitch: a planted sole must stay flat and avoid
    // clipping through the floor at heel/toe as the walk cycle changes.
    shoePitch[index] = -Math.min(.045, lift * .42)
    return {
      hip,
      knee: walkingKnee,
      ankle,
      foot: [side * .17, .078 + lift, footZ * (1 - seated) + .675 * seated] as RigPoint,
    }
  }) as [Leg, Leg]
  return {
    torsoDrop: seated * .4,
    headPitch: (activity === 'researching' ? -.09 : activity === 'error' ? .14 : stride * Math.sin(gaitPhase * 2) * .018)
      + phone * .26 - look * .07 - lap * .03,
    headRoll: activity === 'thinking' ? Math.sin(seconds * 1.2) * .035 : stride * Math.sin(gaitPhase) * .018,
    // Calm breathing keeps idle characters alive without suggesting speech
    // or a conversation that did not occur.
    bob: Math.sin(seconds * 2.1) * .008 * (1 - stride) * (1 - seated * .2),
    shoePitch,
    arms,
    legs,
  }
}
