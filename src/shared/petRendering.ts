export const ANTIALIASING_SAMPLES = [2, 4, 8] as const
export type AntialiasingSamples = (typeof ANTIALIASING_SAMPLES)[number]

export function isAntialiasingSamples(value: unknown): value is AntialiasingSamples {
  return ANTIALIASING_SAMPLES.some(samples => samples === value)
}

/** SSAA multipliers count pixels, so each canvas dimension grows by sqrt(samples). */
export function petRenderResolution(
  enabled: boolean,
  samples: AntialiasingSamples,
  pixelRatio: number,
  width: number,
  height: number,
  maxDimension = 8192
): number {
  if (!enabled) return 1
  const density = Number.isFinite(pixelRatio) ? Math.max(1, pixelRatio) : 1
  // Respect GPU limits and bound the color buffer to 16 million pixels.
  return Math.min(
    density * Math.sqrt(isAntialiasingSamples(samples) ? samples : 2),
    maxDimension / Math.max(1, width),
    maxDimension / Math.max(1, height),
    Math.sqrt(16_000_000 / (Math.max(1, width) * Math.max(1, height)))
  )
}
