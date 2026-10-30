// Where the analysis and Review meet. Review says which reviews the Property has now
// (a review Google no longer shows, or whose text has expired, is not among them); the
// analysis says what each of those says. A page counts a review only when both agree on
// it: the same review, in the same revision and analysis sequence, on the same day. So an
// analysis of a review that has since gone, or changed and awaits a new analysis, is
// never counted as though it still stood.
import type { AiTrendPopulationReview } from '#/contexts/review/application/public-api'
import { ratingCountsOf } from '../aspect-review-evidence'
import type { GuestVoiceUnavailableReview } from '../ports/ai-guest-voice-facts.port'
import type { WindowPopulation } from './guest-voice-v2-build'
import type { GuestVoiceReview } from './guest-voice-v2-facts'

export type Period = Readonly<{ startLocalDate: string; endLocalDate: string }>

export type JoinedPeriod = Readonly<{
  /** Reviews of the period with a current analysis. */
  analysed: readonly GuestVoiceReview[]
  /** What Review counted in the period: its stars, and how many have text. */
  population: WindowPopulation
  /** Reviews with text that have no analysis yet, and so make a figure provisional. */
  awaitingAnalysis: number
}>

type VersionedReview = Readonly<{
  reviewId: string
  sourceRevision: number
  analysisSequence: number
}>

/** The key Review and the analysis agree a review's current version by. */
export function reviewVersionKey(review: VersionedReview): string {
  return `${review.reviewId}:${review.sourceRevision}:${review.analysisSequence}`
}

function inPeriod(localDate: string, period: Period): boolean {
  return localDate >= period.startLocalDate && localDate <= period.endLocalDate
}

export function joinPeriod(
  period: Period,
  population: readonly AiTrendPopulationReview[],
  analysed: readonly GuestVoiceReview[],
  unavailable: readonly GuestVoiceUnavailableReview[],
): JoinedPeriod {
  const here = population.filter((review) => inPeriod(review.localDate, period))
  const byVersion = new Map(here.map((review) => [reviewVersionKey(review), review]))
  const counted = analysed.filter(
    (review) => byVersion.get(reviewVersionKey(review))?.localDate === review.localDate,
  )
  const settled = new Set([
    ...counted.map(reviewVersionKey),
    ...unavailable
      .filter(
        (review) =>
          byVersion.get(reviewVersionKey(review))?.localDate === review.localDate,
      )
      .map(reviewVersionKey),
  ])
  const withText = here.filter((review) => review.hasText)
  return {
    analysed: counted,
    population: { stars: ratingCountsOf(here), textReviews: withText.length },
    awaitingAnalysis: withText.filter((review) => !settled.has(reviewVersionKey(review)))
      .length,
  }
}
