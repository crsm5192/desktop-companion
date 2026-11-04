/** The tail anchors above the crown; most of the bubble extends to its right. */
export function placeSpeechBubble(
  head: { x: number; y: number }, bubble: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number; tailX: number } {
  const margin = 8
  const left = Math.max(margin, Math.min(viewport.width - bubble.width - margin, head.x - 24))
  const top = Math.max(margin, Math.min(viewport.height - bubble.height - margin, head.y - bubble.height - 14))
  const tailX = Math.max(18, Math.min(bubble.width - 18, head.x - left))
  return { left, top, tailX }
}
