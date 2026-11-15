// Deterministic force-directed layout for the knowledge graph popup, in 2D or 3D.
// Springs pull linked nodes together, nearby nodes repel (via a spatial grid,
// so cost stays roughly linear) and weak gravity keeps components on screen.

export type LayoutNode = { id: string; weight?: number }
export type LayoutLink = { source: string; target: string; length?: number }
export type Point = { x: number; y: number; z?: number }

const REPULSE = 7000, CUTOFF = 260, SPRING = .045, GRAVITY = .01, DAMPING = .82

export function forceLayout(nodes: LayoutNode[], links: LayoutLink[], iterations = 320, dimensions: 2 | 3 = 2): Map<string, Point> {
  const count = nodes.length, depth = dimensions === 3
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  // Golden-angle spiral (2D) or spherical Fibonacci shell (3D) start: deterministic and already spread out.
  const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count)
  const vx = new Float64Array(count), vy = new Float64Array(count), vz = new Float64Array(count)
  nodes.forEach((_, i) => {
    const a = i * 2.39996
    if (!depth) { const r = 22 * Math.sqrt(i + 1); x[i] = Math.cos(a) * r; y[i] = Math.sin(a) * r; return }
    const r = 30 * Math.cbrt(i + 1), h = 1 - 2 * ((i + .5) / count), ring = Math.sqrt(1 - h * h)
    x[i] = Math.cos(a) * ring * r; y[i] = h * r; z[i] = Math.sin(a) * ring * r
  })
  const cell = (value: number) => Math.floor(value / CUTOFF)
  const springs = links.map(link => [index.get(link.source), index.get(link.target), link.length ?? 70] as const)
    .filter((spring): spring is readonly [number, number, number] => spring[0] !== undefined && spring[1] !== undefined)
  const mass = nodes.map(node => 1 + (node.weight ?? 0) * .15)
  for (let step = 0; step < iterations; step++) {
    const heat = 1 - step / iterations * .85
    const fx = new Float64Array(count), fy = new Float64Array(count), fz = new Float64Array(count)
    // Repulsion between nodes in the same or neighbouring grid cells.
    const grid = new Map<string, number[]>()
    for (let i = 0; i < count; i++) {
      const key = `${cell(x[i])},${cell(y[i])},${cell(z[i])}`
      const bucket = grid.get(key); if (bucket) bucket.push(i); else grid.set(key, [i])
    }
    const reach = depth ? 1 : 0
    for (let i = 0; i < count; i++) {
      const cx = cell(x[i]), cy = cell(y[i]), cz = cell(z[i])
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (let gz = cz - reach; gz <= cz + reach; gz++) {
        for (const j of grid.get(`${gx},${gy},${gz}`) ?? []) {
          if (j <= i) continue
          let dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j], d2 = dx * dx + dy * dy + dz * dz
          if (d2 > CUTOFF * CUTOFF) continue
          if (d2 < .01) { dx = (i - j) * .1 + .1; dy = .1; dz = depth ? .1 : 0; d2 = dx * dx + dy * dy + dz * dz }
          const d = Math.sqrt(d2), force = REPULSE / d2
          fx[i] += dx / d * force; fy[i] += dy / d * force; fz[i] += dz / d * force
          fx[j] -= dx / d * force; fy[j] -= dy / d * force; fz[j] -= dz / d * force
        }
      }
    }
    for (const [a, b, length] of springs) {
      const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a], d = Math.max(.01, Math.hypot(dx, dy, dz))
      const force = SPRING * (d - length)
      fx[a] += dx / d * force; fy[a] += dy / d * force; fz[a] += dz / d * force
      fx[b] -= dx / d * force; fy[b] -= dy / d * force; fz[b] -= dz / d * force
    }
    for (let i = 0; i < count; i++) {
      fx[i] -= x[i] * GRAVITY; fy[i] -= y[i] * GRAVITY; fz[i] -= z[i] * GRAVITY
      vx[i] = (vx[i] + fx[i] / mass[i]) * DAMPING; vy[i] = (vy[i] + fy[i] / mass[i]) * DAMPING; vz[i] = (vz[i] + fz[i] / mass[i]) * DAMPING
      const speed = Math.hypot(vx[i], vy[i], vz[i]), limit = 30 * heat
      if (speed > limit) { vx[i] *= limit / speed; vy[i] *= limit / speed; vz[i] *= limit / speed }
      x[i] += vx[i]; y[i] += vy[i]; z[i] += vz[i]
    }
  }
  return new Map(nodes.map((node, i) => [node.id, depth ? { x: x[i], y: y[i], z: z[i] } : { x: x[i], y: y[i] }]))
}

/** Bounding box of the laid-out points, padded; a minimum size keeps tiny graphs from zooming in absurdly. */
export function layoutBounds(points: Iterable<Point>, padding = 60, minimum = 320) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  if (!Number.isFinite(minX)) return { x: -minimum / 2, y: -minimum / 2, width: minimum, height: minimum }
  const width = Math.max(minimum, maxX - minX + padding * 2), height = Math.max(minimum * .6, maxY - minY + padding * 2)
  return { x: (minX + maxX) / 2 - width / 2, y: (minY + maxY) / 2 - height / 2, width, height }
}
