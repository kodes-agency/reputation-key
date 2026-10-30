import type { AiTrendPopulationReview } from '#/contexts/review/application/public-api'
import {
  GUEST_VOICE_RATING_TREND_VERSION,
  ratingTrendVerdict,
} from '../../domain/guest-voice-rating-trend'
import { ratingCountsOf } from '../aspect-review-evidence'
import { addDays } from '../local-date'
import type {
  GuestVoiceRatingTrend,
  GuestVoiceRatingMonth,
  RatingTrendPeriod,
} from './guest-voice-v2-check-in'
import type { Period } from './guest-voice-v2-join'
import { calendarMonths } from './guest-voice-v2-recency'

export function ratingComparisonPeriods(
  period: Period,
): Readonly<{ before: Period; recent: Period }> {
  // At most 365 days, calculated with Property-local civil date arithmetic.
  let days = 1
  for (let day = period.startLocalDate; day < period.endLocalDate; day = addDays(day, 1))
    days += 1
  const recentStart = addDays(
    period.endLocalDate,
    -(Math.min(90, Math.max(7, Math.floor(days / 4))) - 1),
  )
  return {
    before: {
      startLocalDate: period.startLocalDate,
      endLocalDate: addDays(recentStart, -1),
    },
    recent: { startLocalDate: recentStart, endLocalDate: period.endLocalDate },
  }
}
function commentsIn(population: readonly AiTrendPopulationReview[], period: Period) {
  return population.filter(
    (r) =>
      r.hasText &&
      r.localDate >= period.startLocalDate &&
      r.localDate <= period.endLocalDate,
  )
}
function periodFigures(
  population: readonly AiTrendPopulationReview[],
  period: Period,
): RatingTrendPeriod {
  const reviews = commentsIn(population, period)
  return {
    ...period,
    reviewCount: reviews.length,
    averageStars:
      reviews.length === 0
        ? null
        : reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length,
    happyReviewCount: reviews.filter((r) => r.rating >= 4).length,
  }
}
export function ratingMonthSeries(
  population: readonly AiTrendPopulationReview[],
  period: Period,
): readonly GuestVoiceRatingMonth[] {
  return calendarMonths(period).map((month) => ({
    ...month,
    ...periodFigures(population, month),
  }))
}
export function buildRatingTrend(
  population: readonly AiTrendPopulationReview[],
  period: Period,
  provisional: boolean,
): GuestVoiceRatingTrend {
  const split = ratingComparisonPeriods(period)
  return {
    methodVersion: GUEST_VOICE_RATING_TREND_VERSION,
    population: 'current_reviews_with_text',
    months: ratingMonthSeries(population, period),
    before: periodFigures(population, split.before),
    recent: periodFigures(population, split.recent),
    ...ratingTrendVerdict({
      beforeStars: ratingCountsOf(commentsIn(population, split.before)),
      recentStars: ratingCountsOf(commentsIn(population, split.recent)),
      provisional,
    }),
  }
}
