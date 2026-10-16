// Review context — the exact average at each week's end (pure).
//
// The rating goal's chart draws the exact average over time (round 5, PLAN-D
// E14). The read sums each Property-local week since an instant and every
// current review there is, in one statement; this works back from today: the
// average at the end of the last week is every review's, and each earlier
// week ends where the later weeks' reviews are taken away again. The week
// sums stay here: what leaves is counts and averages only (ADR 0067, round 5).

import type {
  GoogleRatingHistory,
  GoogleRatingTotals,
  GoogleRatingWeekHistory,
} from './ports/google-rating-reads.port'

/** One week's count and star sum, as the read groups them. */
export type GoogleRatingWeekTotals = GoogleRatingTotals & Readonly<{ weekStart: string }>

/** sum / count in thousandths, half up; null without reviews. */
const thousandthsOf = (totals: GoogleRatingTotals): number | null =>
  totals.count === 0
    ? null
    : Math.floor((2 * totals.sum * 1000 + totals.count) / (2 * totals.count))

/**
 * The average at the end of each week, and where it stood before the first:
 * E(k) = (S − Σ later sums) / (N − Σ later counts).
 */
export function endOfWeekAverages(
  all: GoogleRatingTotals,
  weeks: readonly GoogleRatingWeekTotals[],
): GoogleRatingHistory {
  const newestFirst = [...weeks].sort((a, b) => b.weekStart.localeCompare(a.weekStart))
  const walked = newestFirst.reduce<
    Readonly<{ remaining: GoogleRatingTotals; ends: readonly GoogleRatingWeekHistory[] }>
  >(
    ({ remaining, ends }, week) => ({
      remaining: { count: remaining.count - week.count, sum: remaining.sum - week.sum },
      ends: [
        {
          weekStart: week.weekStart,
          count: week.count,
          // Never 0: what remains still holds this week's own reviews.
          endAverageThousandths: thousandthsOf(remaining) ?? 0,
        },
        ...ends,
      ],
    }),
    { remaining: all, ends: [] },
  )
  return { startAverageThousandths: thousandthsOf(walked.remaining), weeks: walked.ends }
}
