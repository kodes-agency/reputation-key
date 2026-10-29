// The reads the Guest voice stories and tests stand on: a property that gets about
// 128 reviews with text in 90 days, and one that gets about three a month.
//
// Every topic row is worked out from the stars its reviews gave and the stars of
// the whole window, by the same functions the read model uses, so a story never
// shows a figure the read could not have produced.
import {
  starsOfMentioned,
  type RatingCounts,
  type WindowRatings,
} from '#/contexts/ai/application/aspect-review-evidence'
import type {
  AiPropertyInsightAspect,
  AiPropertyInsightComparedAspect,
  AiPropertyInsightsPresetReady,
} from '#/contexts/ai/application/public-api'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'

type RowSpec = Readonly<{
  aspect: AspectTaxonomyV1Id
  polarity: AspectPolarityV1
  /** Stars of the reviews that name it: how many gave 1, 2, 3, 4 and 5. */
  ratings: RatingCounts
  /**
   * Reviews that name the topic in any way, when it is not the sum of its rows
   * (a review that both praises and criticises it). Said on one row of the topic.
   */
  topicReviews?: number
  change?: AiPropertyInsightAspect['change']
  /** Reviews that named it in the period before. */
  before?: number
}>

const sum = (counts: readonly number[]) =>
  counts.reduce((total, count) => total + count, 0)

function compared(
  specs: readonly RowSpec[],
  window: WindowRatings,
): readonly AiPropertyInsightComparedAspect[] {
  const topicReviews = new Map<AspectTaxonomyV1Id, number>()
  for (const spec of specs) {
    topicReviews.set(
      spec.aspect,
      (topicReviews.get(spec.aspect) ?? 0) + sum(spec.ratings),
    )
  }
  for (const spec of specs) {
    if (spec.topicReviews !== undefined) topicReviews.set(spec.aspect, spec.topicReviews)
  }
  return specs.map((spec) => {
    const reviewCount = sum(spec.ratings)
    return {
      aspect: spec.aspect,
      polarity: spec.polarity,
      // A few reviews name a topic twice.
      mentionCount: reviewCount + Math.floor(reviewCount / 10),
      reviewCount,
      topicReviewCount: topicReviews.get(spec.aspect) ?? reviewCount,
      ratingCounts: spec.ratings,
      stars: starsOfMentioned(spec.ratings, window),
      change: spec.change ?? 'unknown',
      comparison: {
        precedingMentionCount: spec.before ?? reviewCount,
        precedingReviewCount: spec.before ?? reviewCount,
      },
    }
  })
}

// ── A large property: 128 reviews with text in 90 days ─────────────────────

const LARGE_WINDOW: WindowRatings = {
  ratingCounts: [11, 14, 20, 38, 67],
  reviewCount: 150,
}

export const LARGE_PROPERTY_ROWS = compared(
  [
    {
      aspect: 'service',
      polarity: 'negative',
      ratings: [8, 6, 3, 1, 1],
      change: 'rising',
      before: 7,
    },
    { aspect: 'service', polarity: 'positive', ratings: [0, 0, 1, 2, 4] },
    {
      aspect: 'cleanliness',
      polarity: 'positive',
      ratings: [0, 0, 1, 6, 17],
      before: 22,
    },
    // One review praises the room and complains about it: 25 reviews, not 26.
    {
      aspect: 'room',
      polarity: 'negative',
      ratings: [3, 5, 5, 3, 1],
      topicReviews: 25,
      before: 21,
    },
    { aspect: 'room', polarity: 'positive', ratings: [0, 0, 0, 3, 6] },
    { aspect: 'staff', polarity: 'positive', ratings: [0, 0, 0, 3, 13], before: 11 },
    {
      aspect: 'wait_time',
      polarity: 'negative',
      ratings: [3, 4, 3, 2, 1],
      change: 'falling',
      before: 27,
    },
    { aspect: 'food_and_drink', polarity: 'positive', ratings: [0, 0, 1, 3, 8] },
    { aspect: 'value', polarity: 'positive', ratings: [0, 0, 2, 4, 5] },
    { aspect: 'parking', polarity: 'negative', ratings: [1, 2, 3, 2, 2] },
    { aspect: 'noise', polarity: 'negative', ratings: [1, 2, 3, 2, 1] },
    { aspect: 'amenities', polarity: 'positive', ratings: [0, 0, 0, 3, 5] },
    { aspect: 'location', polarity: 'positive', ratings: [0, 0, 0, 2, 5] },
    { aspect: 'wifi_and_tech', polarity: 'negative', ratings: [0, 1, 2, 2, 1] },
    { aspect: 'quality', polarity: 'positive', ratings: [0, 0, 0, 1, 4] },
  ],
  LARGE_WINDOW,
)

export const LARGE_PROPERTY: AiPropertyInsightsPresetReady = {
  status: 'ready',
  provisional: false,
  coverage: {
    settledAnalysisCount: 150,
    expectedAnalysisCount: 150,
    awaitingAnalysisCount: 0,
  },
  range: 90,
  startLocalDate: '2026-06-13',
  endLocalDate: '2026-09-10',
  precedingPeriod: { startLocalDate: '2026-03-15', endLocalDate: '2026-06-12' },
  dataThroughLocalDate: '2026-09-10',
  window: { selection: 'automatic', textReviewCount: 128, enoughForPatterns: true },
  aspectEvidenceState: 'available',
  basis: {
    reviewCount: 150,
    analyzedReviewCount: 120,
    preAspectAnalysisCount: 0,
    currentAnalysisCount: 128,
    starOnlyCount: 22,
    notAnalyzableCount: 8,
    awaitingAnalysisCount: 0,
    ratingDistribution: LARGE_WINDOW.ratingCounts.map((count, index) => ({
      stars: (index + 1) as 1 | 2 | 3 | 4 | 5,
      count,
    })),
  },
  aspects: LARGE_PROPERTY_ROWS,
  weeklyAspectSeries: [],
  emergingIssues: [
    { label: 'front desk delays', count: 12 },
    { label: 'bathroom maintenance', count: 7 },
    { label: 'air conditioning noise', count: 4 },
  ],
}

// ── A small property: about three reviews with text a month ────────────────

const SMALL_WINDOW: WindowRatings = { ratingCounts: [2, 3, 5, 12, 22], reviewCount: 44 }

const SMALL_PROPERTY_ROWS = compared(
  [
    { aspect: 'staff', polarity: 'positive', ratings: [0, 0, 1, 4, 9] },
    { aspect: 'room', polarity: 'negative', ratings: [1, 2, 1, 0, 0] },
    { aspect: 'cleanliness', polarity: 'positive', ratings: [0, 0, 0, 3, 6] },
    { aspect: 'service', polarity: 'negative', ratings: [0, 1, 1, 0, 0] },
    { aspect: 'location', polarity: 'positive', ratings: [0, 0, 0, 2, 3] },
    { aspect: 'parking', polarity: 'negative', ratings: [0, 0, 1, 0, 0] },
  ],
  SMALL_WINDOW,
)

/** About 3 reviews with text a month, so no shorter window than 12 months holds enough. */
export const SMALL_PROPERTY: AiPropertyInsightsPresetReady = {
  ...LARGE_PROPERTY,
  range: 365,
  startLocalDate: '2025-09-11',
  endLocalDate: '2026-09-10',
  precedingPeriod: { startLocalDate: '2024-09-11', endLocalDate: '2025-09-10' },
  window: { selection: 'automatic', textReviewCount: 36, enoughForPatterns: true },
  coverage: {
    settledAnalysisCount: 44,
    expectedAnalysisCount: 44,
    awaitingAnalysisCount: 0,
  },
  basis: {
    reviewCount: 44,
    analyzedReviewCount: 34,
    preAspectAnalysisCount: 0,
    currentAnalysisCount: 36,
    starOnlyCount: 8,
    notAnalyzableCount: 2,
    awaitingAnalysisCount: 0,
    ratingDistribution: SMALL_WINDOW.ratingCounts.map((count, index) => ({
      stars: (index + 1) as 1 | 2 | 3 | 4 | 5,
      count,
    })),
  },
  aspects: SMALL_PROPERTY_ROWS,
  emergingIssues: [{ label: 'slow wifi', count: 2 }],
}
