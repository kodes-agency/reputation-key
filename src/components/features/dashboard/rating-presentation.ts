import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import type { RatingComparisonWithheld } from '#/contexts/reporting/application/public-api'

export type RatingPresentationInput = Readonly<{
  value: number | null
  comparison: number | null
  /** The server's reason for a missing comparison; the client keeps no floor. */
  comparisonWithheld?: RatingComparisonWithheld | null
  sampleCount: number
  priorSampleCount: number
}>

export type RatingPresentation = Readonly<{
  /** The card label, which always states the sample the average rests on. */
  label: string
  value: string
  comparison: string
  direction: 'up' | 'down' | 'neutral'
  evidence: string
}>

/**
 * The server decides why a comparison is missing. The client holds no floor of
 * its own, so the two can never disagree, and a pipeline that is not ready is
 * never blamed on the sample size.
 */
function withheldCopy(reason: RatingComparisonWithheld | null | undefined): string {
  if (reason === 'sample_too_small')
    return 'Not enough ratings in both periods to compare.'
  if (reason === 'evidence_not_ready') {
    return 'No comparison while a period is still being checked.'
  }
  return 'No comparison available.'
}

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
  const sample = `${rating.sampleCount.toLocaleString('en-US')} eligible ${rating.sampleCount === 1 ? 'rating' : 'ratings'}.`
  const explanation =
    timeRange === 'all'
      ? 'All-time view has no prior-period comparison.'
      : comparison === null
        ? withheldCopy(rating.comparisonWithheld)
        : `${comparisonText} stars vs prior period`

  return {
    label: `Average private rating (n = ${rating.sampleCount.toLocaleString('en-US')})`,
    value: rating.value === null ? '—' : `${rating.value.toFixed(1)} / 5`,
    comparison: comparisonText,
    direction,
    evidence: `${sample} ${explanation}`,
  }
}
