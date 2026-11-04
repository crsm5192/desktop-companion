import type { Rectangle } from 'electron'

const SNAP_DISTANCE = 24

/** Snap each axis independently, so corners work too and dragging away releases it. */
export function snapWindowPosition(bounds: Rectangle, workArea: Rectangle): { x: number; y: number } {
  const snap = (value: number, first: number, last: number): number => {
    const edge = Math.abs(value - first) <= Math.abs(value - last) ? first : last
    return Math.abs(value - edge) <= SNAP_DISTANCE ? edge : value
  }
  return {
    x: snap(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
    y: snap(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height)
  }
}
