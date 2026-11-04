interface Rect { x: number; y: number; width: number; height: number }

/** Prefer a readable side window; use space above/below on narrow displays. */
export function placeChatWindow(pet: Rect, work: Rect, size = { width: 360, height: 520 }): Rect {
  const gap = 12, margin = 8
  const left = work.x + margin, top = work.y + margin
  const right = work.x + work.width - margin, bottom = work.y + work.height - margin
  const width = Math.min(size.width, right - left)
  const height = Math.min(size.height, bottom - top)
  const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n))
  const y = clamp(pet.y + pet.height - height, top, bottom - height)
  const rightSpace = right - pet.x - pet.width - gap
  const leftSpace = pet.x - gap - left
  if (rightSpace >= width) return { x: pet.x + pet.width + gap, y, width, height }
  if (leftSpace >= width) return { x: pet.x - width - gap, y, width, height }
  if (Math.max(rightSpace, leftSpace) >= 280) {
    const w = Math.min(width, Math.max(rightSpace, leftSpace))
    return { x: rightSpace >= leftSpace ? pet.x + pet.width + gap : pet.x - w - gap, y, width: w, height }
  }
  const x = clamp(pet.x + (pet.width - width) / 2, left, right - width)
  const above = pet.y - gap - top, below = bottom - pet.y - pet.height - gap
  if (Math.max(above, below) >= 260) {
    const h = Math.min(height, Math.max(above, below))
    return { x, y: below >= above ? pet.y + pet.height + gap : pet.y - h - gap, width, height: h }
  }
  // Extremely small work areas cannot fit both full windows. Keep chat readable
  // at the far edge, with the pet remaining above it in the window stacking order.
  return { x: rightSpace >= leftSpace ? right - width : left, y, width, height }
}
