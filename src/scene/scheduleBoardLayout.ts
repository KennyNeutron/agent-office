import type { OfficeLayout } from './officeLayout'

// The board stands beside the reception desk, angled toward the default camera.
// Walking routes stay east of the service wing, so it never blocks an avatar.
const OFFSET: [number, number] = [-1.75, 1.55]
export const BOARD_ROTATION = .66
export const BOARD_LABEL_HEIGHT = 2.95
export function scheduleBoardPosition(layout: OfficeLayout): [number, number, number] {
  const reception = layout.amenities.find(item => item.id === 'reception')
  return [(reception?.x ?? 3) + OFFSET[0], 0, (reception?.z ?? 2.9) + OFFSET[1]]
}

