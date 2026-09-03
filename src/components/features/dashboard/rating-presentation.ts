import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'

export type RatingPresentationInput = Readonly<{
  value: number | null
  comparison: number | null
  sampleCount: number
  priorSampleCount: number
}>

export type RatingPresentation = Readonly<{
  value: string
  comparison: string
  direction: 'up' | 'down' | 'neutral'
  evidence: string
}>

export function ratingPresentation(
  rating: RatingPresentationInput,
  timeRange: TimeRangePreset,
): RatingPresentation {
  const comparison = rating.comparison
  const direction =
    comparison === null || comparison === 0 ? 'neutral' : comparison > 0 ? 'up' : 'down'
  const comparisonText =
    comparison === null
      ? '—'
      : `${comparison > 0 ? '+' : comparison < 0 ? '−' : ''}${Math.abs(comparison).toFixed(1)}`
  const sample = `${rating.sampleCount.toLocaleString()} eligible ${rating.sampleCount === 1 ? 'rating' : 'ratings'}.`
  const explanation =
    timeRange === 'all'
      ? 'All-time view has no prior-period comparison.'
      : rating.sampleCount < 10 || rating.priorSampleCount < 10
        ? 'Comparison needs 10 ratings in each period.'
        : `${comparisonText} stars vs prior period`

  return {
    value: rating.value === null ? '—' : `${rating.value.toFixed(1)} / 5`,
    comparison: comparisonText,
    direction,
    evidence: `${sample} ${explanation}`,
  }
}
