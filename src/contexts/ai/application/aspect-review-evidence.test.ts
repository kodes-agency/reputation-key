import { describe, expect, it } from 'vitest'
import { reviewId } from '#/shared/domain/ids'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import {
  MAX_RECURRING_ISSUES,
  RECURRING_ISSUE_MIN_REVIEWS,
  aspectKey,
  changeOfMentions,
  collectAspectReviewEvidence,
  countIssueLabels,
  recurringIssues,
  starsOfMentioned,
  type RatingCounts,
} from './aspect-review-evidence'
import type { AiPropertyAnalyzedReview } from './ports/ai-property-aggregate-store.port'

type Mention = readonly [AspectTaxonomyV1Id, AspectPolarityV1, number?]

function analysed(
  sequence: number,
  rating: number,
  mentions: readonly Mention[],
  issueLabel: string | null = null,
): AiPropertyAnalyzedReview {
  return Object.freeze({
    reviewId: reviewId(`00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`),
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate: '2026-08-10',
    rating,
    sentiment: 'neutral' as const,
    attention: 'low' as const,
    aspects: mentions.map(([aspect, polarity, intensity]) => ({
      aspect,
      polarity,
      intensity: intensity ?? 100,
    })),
    issueLabel,
    analysisProfileVersion: 'review-analysis-v2',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    modelSnapshot: 'gpt-5-mini-2025-08-07',
  })
}

describe('collectAspectReviewEvidence', () => {
  it('counts reviews, not mentions, for a topic a review names twice', () => {
    const { byAspect, reviewsByTopic } = collectAspectReviewEvidence([
      analysed(1, 2, [
        ['room', 'negative'],
        ['room', 'negative'],
      ]),
      analysed(2, 4, [['room', 'negative']]),
    ])

    expect(byAspect.get(aspectKey('room', 'negative'))).toMatchObject({
      mentionCount: 3,
      reviewCount: 2,
      ratingCounts: [0, 1, 0, 1, 0],
    })
    expect(reviewsByTopic.get('room')).toBe(2)
  })

  it('keeps praise and complaints apart and counts a review that does both once for the topic', () => {
    const { byAspect, reviewsByTopic } = collectAspectReviewEvidence([
      analysed(1, 3, [
        ['staff', 'positive'],
        ['staff', 'negative'],
      ]),
      analysed(2, 5, [['staff', 'positive']]),
    ])

    expect(byAspect.get(aspectKey('staff', 'positive'))).toMatchObject({
      reviewCount: 2,
      ratingCounts: [0, 0, 1, 0, 1],
    })
    expect(byAspect.get(aspectKey('staff', 'negative'))).toMatchObject({
      reviewCount: 1,
      ratingCounts: [0, 0, 1, 0, 0],
    })
    expect(reviewsByTopic.get('staff')).toBe(2)
  })

  it('files a rating under the stars it counts as: whole, from 1 to 5', () => {
    const { byAspect } = collectAspectReviewEvidence([
      analysed(1, 0, [['value', 'negative']]),
      analysed(2, 9, [['value', 'negative']]),
      analysed(3, 3.6, [['value', 'negative']]),
    ])

    expect(byAspect.get(aspectKey('value', 'negative'))?.ratingCounts).toEqual([
      1, 0, 0, 1, 1,
    ])
  })

  it('has nothing for reviews that name no topic', () => {
    const { byAspect, reviewsByTopic } = collectAspectReviewEvidence([analysed(1, 5, [])])

    expect(byAspect.size).toBe(0)
    expect(reviewsByTopic.size).toBe(0)
  })
})

describe('starsOfMentioned', () => {
  // Ten reviews in the window: three 1-star reviews that complain, seven 5-star
  // reviews that do not (two of them have only stars, no text).
  const WINDOW: RatingCounts = [3, 0, 0, 0, 7]

  it('puts the stars of the reviews that name a topic against every other review', () => {
    const stars = starsOfMentioned([3, 0, 0, 0, 0], {
      ratingCounts: WINDOW,
      reviewCount: 10,
    })

    expect(stars.mentionedAverage).toBe(1)
    expect(stars.othersAverage).toBe(5)
    expect(stars.gap).toBe(4)
    // 3 of 10 reviews x 4 stars of gap = 1.2 stars on the window average.
    expect(stars.upTo).toBe(1.2)
  })

  it('has no upside to claim under three reviews', () => {
    const stars = starsOfMentioned([2, 0, 0, 0, 0], {
      ratingCounts: WINDOW,
      reviewCount: 10,
    })

    expect(stars.mentionedAverage).toBe(1)
    expect(stars.upTo).toBeNull()
  })

  it('has no averages for a topic no review names', () => {
    const stars = starsOfMentioned([0, 0, 0, 0, 0], {
      ratingCounts: WINDOW,
      reviewCount: 10,
    })

    expect(stars).toEqual({
      mentionedAverage: null,
      othersAverage: 3.8,
      gap: null,
      upTo: null,
    })
  })

  it('never reports a negative gap as upside', () => {
    const stars = starsOfMentioned([0, 0, 0, 0, 4], {
      ratingCounts: [3, 0, 0, 0, 7],
      reviewCount: 10,
    })

    expect(stars.gap).toBeLessThan(0)
    expect(stars.upTo).toBe(0)
  })

  it('never takes a share above one when the window count is smaller than the mentions', () => {
    const stars = starsOfMentioned([3, 0, 0, 0, 0], {
      ratingCounts: [3, 0, 0, 0, 1],
      reviewCount: 1,
    })

    // Three of three reviews, one star against five: the whole gap, not three times it.
    expect(stars.upTo).toBe(4)
  })
})

describe('changeOfMentions', () => {
  it('is unknown when either period holds under ten reviews to compare', () => {
    expect(
      changeOfMentions(
        { reviewCount: 5, textReviews: 8 },
        { reviewCount: 5, textReviews: 40 },
      ),
    ).toBe('unknown')
  })

  it('calls a jump from 10% to 60% of reviews a likely rise', () => {
    expect(
      changeOfMentions(
        { reviewCount: 12, textReviews: 20 },
        { reviewCount: 3, textReviews: 30 },
      ),
    ).toBe('rising')
  })

  it('calls a steady share steady', () => {
    expect(
      changeOfMentions(
        { reviewCount: 4, textReviews: 40 },
        { reviewCount: 4, textReviews: 40 },
      ),
    ).toBe('steady')
  })
})

describe('recurring issues', () => {
  const reviews = [
    analysed(1, 2, [], 'slow front desk'),
    analysed(2, 3, [], 'slow front desk'),
    analysed(3, 3, [], 'slow front desk'),
    analysed(4, 2, [], 'noisy air conditioning'),
    analysed(5, 2, [], 'noisy air conditioning'),
    analysed(6, 4, [], 'broken kettle'),
    analysed(7, 5, [], null),
  ]

  it('counts a label once for each review that carries it', () => {
    expect(countIssueLabels(reviews).get('slow front desk')).toBe(3)
    expect(countIssueLabels(reviews).get('broken kettle')).toBe(1)
  })

  it('keeps only labels two or more reviews name, most-named first', () => {
    expect(RECURRING_ISSUE_MIN_REVIEWS).toBe(2)
    expect(recurringIssues(countIssueLabels(reviews))).toEqual([
      { label: 'slow front desk', count: 3 },
      { label: 'noisy air conditioning', count: 2 },
    ])
  })

  it('names at most five, ties broken by label', () => {
    const many = new Map(
      ['f', 'e', 'd', 'c', 'b', 'a'].map((label) => [`issue ${label}`, 2] as const),
    )

    const kept = recurringIssues(many)

    expect(kept).toHaveLength(MAX_RECURRING_ISSUES)
    expect(kept.map((issue) => issue.label)).toEqual([
      'issue a',
      'issue b',
      'issue c',
      'issue d',
      'issue e',
    ])
  })

  it('has none to name when every label stands alone', () => {
    expect(recurringIssues(new Map([['one-off', 1]]))).toEqual([])
  })
})
