// AI context: the review-level facts behind a topic row.
//
// A mention is one topic named once in one analysis; a review is what a manager
// opens. Guest voice used to count mentions ("19 mentions"), which cannot be
// compared with a number of reviews and was never what the Inbox lists when the
// number is followed. These functions count reviews, take the stars those
// reviews gave, and say how those stars sit against the rest of the window; the
// Guest voice read (a chosen window, with the period before it) and the Overview
// read (30 days) share them so the two pages cannot disagree.
//
// Pure functions of an analysed-review list: no I/O, no clock.
import { isAiIssueLabel } from '#/shared/ai-issue-label'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import { likelyChange, starsWhenMentioned } from '../domain/guest-voice-statistics'
import type { AiPropertyAnalyzedReview } from './ports/ai-property-aggregate-store.port'

/** How many reviews gave 1, 2, 3, 4 and 5 stars. */
export type RatingCounts = readonly [number, number, number, number, number]

export const NO_RATING_COUNTS: RatingCounts = Object.freeze([
  0, 0, 0, 0, 0,
]) as RatingCounts

/** A topic and a polarity, as one key. */
export function aspectKey(
  aspect: AspectTaxonomyV1Id,
  polarity: AspectPolarityV1,
): string {
  return `${aspect}:${polarity}`
}

/** One topic, one polarity, counted in reviews. */
export type AspectReviewEvidence = Readonly<{
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  /** Mentions: a review that names the topic twice counts twice. */
  mentionCount: number
  /** Reviews: each review with at least one such mention counts once. */
  reviewCount: number
  /** The stars those reviews gave. */
  ratingCounts: RatingCounts
}>

export type AspectReviewTotals = Readonly<{
  /** One entry for each topic and polarity named in at least one review. */
  byAspect: ReadonlyMap<string, AspectReviewEvidence>
  /** Reviews that name each topic in any way: praise, complaint or neutral. */
  reviewsByTopic: ReadonlyMap<AspectTaxonomyV1Id, number>
}>

/** The stars a rating counts as: a whole number from 1 to 5, as `aspect-impact` clamps it. */
function starIndex(rating: number): number {
  if (!Number.isFinite(rating)) return 0
  return Math.min(5, Math.max(1, Math.round(rating))) - 1
}

/** How many of the reviews gave 1, 2, 3, 4 and 5 stars. */
export function ratingCountsOf(
  reviews: readonly Readonly<{ rating: number }>[],
): RatingCounts {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  for (const review of reviews) {
    const star = starIndex(review.rating)
    counts[star] = (counts[star] ?? 0) + 1
  }
  return counts
}

type MutableEvidence = {
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  mentionCount: number
  reviewCount: number
  ratingCounts: [number, number, number, number, number]
}

export function collectAspectReviewEvidence(
  reviews: readonly AiPropertyAnalyzedReview[],
): AspectReviewTotals {
  const byAspect = new Map<string, MutableEvidence>()
  const reviewsByTopic = new Map<AspectTaxonomyV1Id, number>()
  for (const review of reviews) {
    const star = starIndex(review.rating)
    const seenAspects = new Set<string>()
    const seenTopics = new Set<AspectTaxonomyV1Id>()
    for (const mention of review.aspects) {
      const key = aspectKey(mention.aspect, mention.polarity)
      const total = byAspect.get(key) ?? {
        aspect: mention.aspect,
        polarity: mention.polarity,
        mentionCount: 0,
        reviewCount: 0,
        ratingCounts: [0, 0, 0, 0, 0],
      }
      total.mentionCount += 1
      if (!seenAspects.has(key)) {
        seenAspects.add(key)
        total.reviewCount += 1
        total.ratingCounts[star] = (total.ratingCounts[star] ?? 0) + 1
      }
      byAspect.set(key, total)
      if (!seenTopics.has(mention.aspect)) {
        seenTopics.add(mention.aspect)
        reviewsByTopic.set(mention.aspect, (reviewsByTopic.get(mention.aspect) ?? 0) + 1)
      }
    }
  }
  const frozen = new Map<string, AspectReviewEvidence>()
  for (const [key, total] of byAspect) {
    frozen.set(
      key,
      Object.freeze({ ...total, ratingCounts: Object.freeze(total.ratingCounts) }),
    )
  }
  return Object.freeze({ byAspect: frozen, reviewsByTopic })
}

/** The stars of every review in a window, and how many reviews that is. */
export type WindowRatings = Readonly<{
  ratingCounts: RatingCounts
  reviewCount: number
}>

export type AspectStars = ReturnType<typeof starsWhenMentioned>

function ratingsOf(counts: readonly number[]): number[] {
  return counts.flatMap((count, index) =>
    Array<number>(Math.max(0, count)).fill(index + 1),
  )
}

/**
 * How the stars of the reviews that name a topic sit against the rest of the
 * window. "The rest" is every other review in the window; whether a read can
 * include the reviews with only stars depends on what it was given (the Guest
 * voice read has them; the Overview read, built from analyses, does not).
 */
export function starsOfMentioned(
  mentioned: RatingCounts,
  window: WindowRatings,
): AspectStars {
  const mentionedTotal = mentioned.reduce((sum, count) => sum + count, 0)
  const others = window.ratingCounts.map((count, index) =>
    Math.max(0, count - (mentioned[index] ?? 0)),
  )
  return starsWhenMentioned({
    mentionedRatings: ratingsOf(mentioned),
    otherRatings: ratingsOf(others),
    // A window cannot hold fewer reviews than the ones that mention a topic.
    allReviewsInWindow: Math.max(window.reviewCount, mentionedTotal),
  })
}

export type AspectChange = ReturnType<typeof likelyChange>

/**
 * Whether the share of reviews that name a topic moved against the period
 * before. `unknown` for a window with no period to compare with.
 */
export function changeOfMentions(
  current: Readonly<{ reviewCount: number; textReviews: number }>,
  preceding: Readonly<{ reviewCount: number; textReviews: number }>,
): AspectChange {
  return likelyChange({
    mentions: current.reviewCount,
    textReviews: current.textReviews,
    baselineMentions: preceding.reviewCount,
    baselineReviews: preceding.textReviews,
  })
}

// ── Recurring issues ───────────────────────────────────────────────────────

/** An issue is recurring once two reviews name it; one review is an anecdote. */
export const RECURRING_ISSUE_MIN_REVIEWS = 2
export const MAX_RECURRING_ISSUES = 5

export function countIssueLabels(
  reviews: readonly AiPropertyAnalyzedReview[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const review of reviews) {
    if (review.issueLabel !== null && isAiIssueLabel(review.issueLabel)) {
      counts.set(review.issueLabel, (counts.get(review.issueLabel) ?? 0) + 1)
    }
  }
  return counts
}

/** The labels named in two or more reviews, most-named first, at most five. */
export function recurringIssues(
  counts: ReadonlyMap<string, number>,
): ReadonlyArray<Readonly<{ label: string; count: number }>> {
  return Object.freeze(
    [...counts]
      .filter(([, count]) => count >= RECURRING_ISSUE_MIN_REVIEWS)
      .map(([label, count]) => Object.freeze({ label, count }))
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label),
      )
      .slice(0, MAX_RECURRING_ISSUES),
  )
}
