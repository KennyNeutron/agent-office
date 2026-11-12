import type { OfficeLayout } from './officeLayout'

// The project files sit on the free left end of the reception counter, so they
// never block a walking route. Coordinates are in the reception group's frame.
// Shared with tests so the organizer stays on the counter, clear of the desk props.

/** The file organizer's footprint and height on the counter top (local to the reception desk). */
export const PROJECT_FILES = { x: -1.4, z: -.02, width: .44, depth: .32, height: .2, y: 1.24 }
/** The floating folder hologram above the organizer. */
export const PROJECT_HOLOGRAM_HEIGHT = .62
/** Label anchor above the hologram, in world offsets from the organizer. */
export const PROJECT_LABEL = { dx: .4, y: 2.7, dz: -.9 }

export function projectFilesPosition(layout: OfficeLayout): [number, number, number] {
  const reception = layout.amenities.find(item => item.id === 'reception')
  return [(reception?.x ?? 3) + PROJECT_FILES.x, PROJECT_FILES.y, (reception?.z ?? 2.9) + PROJECT_FILES.z]
}
