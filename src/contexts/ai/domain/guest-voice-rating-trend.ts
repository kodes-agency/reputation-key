import {
  CHANGE_BASELINE_MIN_REVIEWS,
  CHANGE_WINDOW_MIN_REVIEWS,
  likelyChange,
} from './guest-voice-statistics'

export const GUEST_VOICE_RATING_TREND_VERSION = 'guest-voice-rating-trend-v1' as const
export type RatingTrendStars = readonly [number, number, number, number, number]

/** The posterior compares happy share, not mean stars. Both must agree before a claim.
 * Independent Beta(1,1) posteriors, central 95%, default .05 share margin; no search
 * for a favourable boundary. Means use raw counts and must differ by at least .20.
 */
export function ratingTrendVerdict(
  input: Readonly<{
    beforeStars: RatingTrendStars
    recentStars: RatingTrendStars
    provisional: boolean
  }>,
): Readonly<{
  verdict: 'improving' | 'steady' | 'slipping' | 'not_enough'
  reason: 'assessed' | 'too_few_reviews' | 'analysis_incomplete'
}> {
  const before = input.beforeStars.reduce((sum, count) => sum + count, 0)
  const recent = input.recentStars.reduce((sum, count) => sum + count, 0)
  if (input.provisional) return { verdict: 'not_enough', reason: 'analysis_incomplete' }
  if (before < CHANGE_BASELINE_MIN_REVIEWS || recent < CHANGE_WINDOW_MIN_REVIEWS)
    return { verdict: 'not_enough', reason: 'too_few_reviews' }
  const change = likelyChange({
    mentions: input.recentStars[3] + input.recentStars[4],
    textReviews: recent,
    baselineMentions: input.beforeStars[3] + input.beforeStars[4],
    baselineReviews: before,
  })
  const total = (stars: RatingTrendStars) =>
    stars.reduce((sum, n, index) => sum + n * (index + 1), 0)
  // Cross multiplication preserves the inclusive .20 boundary without rounding means.
  const difference =
    (total(input.recentStars) * before - total(input.beforeStars) * recent) * 5
  const threshold = before * recent
  const verdict =
    change === 'rising' && difference >= threshold
      ? 'improving'
      : change === 'falling' && difference <= -threshold
        ? 'slipping'
        : 'steady'
  return { verdict, reason: 'assessed' }
}
