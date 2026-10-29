// What a Property Trend needs before it compares two months, in a module with no
// Node imports. The trend contract (`ai-property-trend-contract.ts`) hashes its
// manifest with `node:crypto`, so the Guest voice page, which says "14 of the 20
// needed", cannot import it; it imports these instead, and the contract
// re-exports them. One number, one place: the generator that decides a state and
// the page that words it read the same ones.

/** Successfully analysed text reviews each of the two 30-day windows must hold. */
export const AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW = 20 as const

/** Share of a window's text reviews that must be analysed, in basis points (9,000 = 90%). */
export const AI_PROPERTY_TREND_MINIMUM_COVERAGE_BASIS_POINTS = 9_000 as const

/**
 * Whether a window is still being analysed, which is what the trend calls
 * Updating.
 *
 * A window with no text review has nothing to analyse, so nothing is missing from
 * it. Its coverage is stored as 0 (0 analysed of 0), which is below the minimum,
 * and read as "incomplete" it put every quiet Property in Updating, for as long as
 * it stayed quiet. Such a window is one with too few reviews: insufficient data.
 */
export function trendWindowIsIncomplete(
  window: Readonly<{ textCandidateCount: number; coverageBasisPoints: number }>,
): boolean {
  return (
    window.textCandidateCount > 0 &&
    window.coverageBasisPoints < AI_PROPERTY_TREND_MINIMUM_COVERAGE_BASIS_POINTS
  )
}
