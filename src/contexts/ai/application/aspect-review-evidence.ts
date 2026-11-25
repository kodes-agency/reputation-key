// AI context: the review-level facts behind a topic row.
//
// A mention is one topic named once in one analysis; a review is what a manager
// opens. Guest voice used to count mentions ("19 mentions"), which cannot be
// compared with a number of reviews and was never what the Inbox lists when the
// number is followed. These functions count reviews, take the stars those
// reviews gave, and say how those stars sit against the rest of the window; the
// Guest voice read (a chosen window, with the 12 months before it) and the Overview
// read (30 days) share them so the two pages cannot disagree.
//
// Pure functions: no I/O, no clock.
import { likelyChange, starsWhenMentioned } from '../domain/guest-voice-statistics'

/** How many reviews gave 1, 2, 3, 4 and 5 stars. */
export type RatingCounts = readonly [number, number, number, number, number]

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
 * Whether the share of reviews that name a topic moved more than its usual ups
 * and downs against the Property's own previous 12 months (`baseline`, counted in
 * analysed reviews with text). `unknown` where the 12 months hold too few of them
 * to have a usual.
 */
export function changeOfMentions(
  current: Readonly<{ reviewCount: number; textReviews: number }>,
  baseline: Readonly<{ reviewCount: number; textReviews: number }>,
): AspectChange {
  return likelyChange({
    mentions: current.reviewCount,
    textReviews: current.textReviews,
    baselineMentions: baseline.reviewCount,
    baselineReviews: baseline.textReviews,
  })
}
