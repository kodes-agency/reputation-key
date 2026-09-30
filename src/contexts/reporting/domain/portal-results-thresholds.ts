// Reporting domain — the sample floors behind Portal results.
//
// Two different questions, two different floors:
//   - is there enough of a sample to show an AVERAGE at all (5 private ratings)
//   - is there enough of a sample in BOTH periods to compare two averages (10)
// The Fleet summary's SQL rating-drop count reads the comparison floor too, so
// the two views cannot drift. Pure and dependency-free: application and
// infrastructure import from here, never the other way round.

/** Private ratings a period needs before its average is shown. */
export const PORTAL_AVERAGE_MIN_SAMPLE = 5

/** Ratings each period needs before an average-to-average comparison is shown. */
export const MIN_RATING_COMPARISON_SAMPLE = 10

/** Evidence reason for an average held back because the sample is too small. */
export const AVERAGE_BELOW_MINIMUM_REASON = 'below_minimum_sample'

export function isAverageShowable(ratingCount: number): boolean {
  return ratingCount >= PORTAL_AVERAGE_MIN_SAMPLE
}

export function isComparisonShowable(
  currentRatingCount: number,
  priorRatingCount: number,
): boolean {
  return (
    currentRatingCount >= MIN_RATING_COMPARISON_SAMPLE &&
    priorRatingCount >= MIN_RATING_COMPARISON_SAMPLE
  )
}

/**
 * Why an average is withheld. Null when nothing is being withheld for size:
 * either there is enough of a sample, or there are no ratings at all (an empty
 * window has its own "no ratings" wording, not a "too few" one).
 */
export function averageWithholdReason(ratingCount: number): string | null {
  return ratingCount > 0 && !isAverageShowable(ratingCount)
    ? AVERAGE_BELOW_MINIMUM_REASON
    : null
}

/**
 * Both floors, as the Results tab receives them. The server applies them and
 * hands them over, so the client keeps no copy to drift from.
 */
export const PORTAL_RESULTS_THRESHOLDS = Object.freeze({
  averageMinSample: PORTAL_AVERAGE_MIN_SAMPLE,
  comparisonMinSample: MIN_RATING_COMPARISON_SAMPLE,
})
