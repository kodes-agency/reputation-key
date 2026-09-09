export const ASPECT_IMPACT_VERSION = 'aspect-impact-v1' as const

export type AspectImpactInput = Readonly<{
  polarity: 'positive' | 'neutral' | 'negative'
  intensity: number
  rating: number
}>

/**
 * Converts one aspect mention into a signed, rating-weighted impact.
 * Ratings and intensity are clamped so malformed historical input cannot
 * produce a value outside the public [-1, 1] contract.
 */
export function computeAspectImpact(input: AspectImpactInput): number {
  if (
    input.polarity === 'neutral' ||
    !Number.isFinite(input.intensity) ||
    !Number.isFinite(input.rating)
  ) {
    return 0
  }

  const magnitude = Math.min(100, Math.abs(input.intensity)) / 100
  const rating = Math.min(5, Math.max(1, input.rating))

  return input.polarity === 'negative'
    ? -magnitude * ((6 - rating) / 5)
    : magnitude * (rating / 5)
}
