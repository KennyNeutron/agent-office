// Deterministic force-directed layout for the knowledge graph popup.
// Springs pull linked nodes together, nearby nodes repel (via a spatial grid,
// so cost stays roughly linear) and weak gravity keeps components on screen.

export type LayoutNode = { id: string; weight?: number }
export type LayoutLink = { source: string; target: string; length?: number }
export type Point = { x: number; y: number }

const REPULSE = 7000, CUTOFF = 260, SPRING = .045, GRAVITY = .01, DAMPING = .82

export function forceLayout(nodes: LayoutNode[], links: LayoutLink[], iterations = 320): Map<string, Point> {
  const count = nodes.length
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  // Golden-angle spiral start: deterministic and already spread out.
  const x = new Float64Array(count), y = new Float64Array(count), vx = new Float64Array(count), vy = new Float64Array(count)
  nodes.forEach((_, i) => { const r = 22 * Math.sqrt(i + 1), a = i * 2.39996; x[i] = Math.cos(a) * r; y[i] = Math.sin(a) * r })
  const springs = links.map(link => [index.get(link.source), index.get(link.target), link.length ?? 70] as const)
    .filter((spring): spring is readonly [number, number, number] => spring[0] !== undefined && spring[1] !== undefined)
  const mass = nodes.map(node => 1 + (node.weight ?? 0) * .15)
  for (let step = 0; step < iterations; step++) {
    const heat = 1 - step / iterations * .85
    const fx = new Float64Array(count), fy = new Float64Array(count)
    // Repulsion between nodes in the same or neighbouring grid cells.
    const grid = new Map<string, number[]>()
    for (let i = 0; i < count; i++) {
      const key = `${Math.floor(x[i] / CUTOFF)},${Math.floor(y[i] / CUTOFF)}`
      const cell = grid.get(key); if (cell) cell.push(i); else grid.set(key, [i])
    }
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(x[i] / CUTOFF), cy = Math.floor(y[i] / CUTOFF)
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j <= i) continue
          let dx = x[i] - x[j], dy = y[i] - y[j], d2 = dx * dx + dy * dy
          if (d2 > CUTOFF * CUTOFF) continue
          if (d2 < .01) { dx = (i - j) * .1 + .1; dy = .1; d2 = dx * dx + dy * dy }
          const d = Math.sqrt(d2), force = REPULSE / d2
          fx[i] += dx / d * force; fy[i] += dy / d * force
          fx[j] -= dx / d * force; fy[j] -= dy / d * force
        }
      }
    }
    for (const [a, b, length] of springs) {
      const dx = x[b] - x[a], dy = y[b] - y[a], d = Math.max(.01, Math.hypot(dx, dy))
      const force = SPRING * (d - length)
      fx[a] += dx / d * force; fy[a] += dy / d * force
      fx[b] -= dx / d * force; fy[b] -= dy / d * force
    }
    for (let i = 0; i < count; i++) {
      fx[i] -= x[i] * GRAVITY; fy[i] -= y[i] * GRAVITY
      vx[i] = (vx[i] + fx[i] / mass[i]) * DAMPING; vy[i] = (vy[i] + fy[i] / mass[i]) * DAMPING
      const speed = Math.hypot(vx[i], vy[i]), limit = 30 * heat
      if (speed > limit) { vx[i] *= limit / speed; vy[i] *= limit / speed }
      x[i] += vx[i]; y[i] += vy[i]
    }
  }
  return new Map(nodes.map((node, i) => [node.id, { x: x[i], y: y[i] }]))
}

/** Bounding box of the laid-out points, padded; a minimum size keeps tiny graphs from zooming in absurdly. */
export function layoutBounds(points: Iterable<Point>, padding = 60, minimum = 320) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  if (!Number.isFinite(minX)) return { x: -minimum / 2, y: -minimum / 2, width: minimum, height: minimum }
  const width = Math.max(minimum, maxX - minX + padding * 2), height = Math.max(minimum * .6, maxY - minY + padding * 2)
  return { x: (minX + maxX) / 2 - width / 2, y: (minY + maxY) / 2 - height / 2, width, height }
}
