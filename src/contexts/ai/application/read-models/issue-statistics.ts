// How the counts behind one issue (or one topic) become the `IssueStatistics` the Guest
// voice 2.0 page prints: every field is an output of the statistics engine
// (`guest-voice-statistics.ts`), given the stars the reviews gave and what the window and
// the 12 months before it hold. The read model (slice 4.1) counts those from the
// effective mentions; the page's fixtures give them by hand, so a story shows only
// figures the read could have produced.
import {
  PERCENT_MIN_REVIEWS,
  evidenceLevel,
  shareText,
} from '../../domain/guest-voice-statistics'
import {
  changeOfMentions,
  starsOfMentioned,
  type RatingCounts,
} from '../aspect-review-evidence'
import type { IssueStatistics } from './guest-voice-v2'

/** How many reviews gave 1, 2, 3, 4 and 5 stars. */
export type StarCounts = RatingCounts

/** What a window holds, and the 12 months before it hold, as the engine is given them. */
export type WindowFacts = Readonly<{
  /** Reviews with text in the window. */
  textReviews: number
  /** Every review in the window, those with only stars included. */
  allReviews: number
  /** The stars of every review in the window: how many gave 1, 2, 3, 4 and 5. */
  stars: StarCounts
  /** Reviews with text in the 12 months before the window. */
  baselineReviews: number
}>

/** What one issue has in the window and, for a change, before it. */
type IssueFacts = Readonly<{
  /** The stars of the reviews that name it. */
  stars: StarCounts
  /** Reviews that named it in the 12 months before the window. */
  before?: number
}>

export function issueStatistics(window: WindowFacts, issue: IssueFacts): IssueStatistics {
  const reviewCount = issue.stars.reduce((sum, count) => sum + count, 0)
  const stars = starsOfMentioned(issue.stars, {
    ratingCounts: window.stars,
    reviewCount: window.allReviews,
  })
  const change = changeOfMentions(
    { reviewCount, textReviews: window.textReviews },
    { reviewCount: issue.before ?? 0, textReviews: window.baselineReviews },
  )
  return {
    reviewCount,
    textReviewCount: window.textReviews,
    allReviewCount: window.allReviews,
    shareText: shareText(reviewCount, window.textReviews),
    // Counts first: a percent only where there are enough reviews to take it of.
    sharePercent:
      window.textReviews >= PERCENT_MIN_REVIEWS
        ? Math.round((reviewCount / window.textReviews) * 100)
        : null,
    mentionedAverage: stars.mentionedAverage,
    othersAverage: stars.othersAverage,
    gap: stars.gap,
    upTo: stars.upTo,
    change,
    evidenceLevel: evidenceLevel({
      mentions: reviewCount,
      textReviews: window.textReviews,
      change,
    }),
  }
}
