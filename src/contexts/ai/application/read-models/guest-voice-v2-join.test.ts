import { describe, expect, it } from 'vitest'
import { reviewVersionKey, joinPeriod } from './guest-voice-v2-join'
import type { GuestVoiceReview } from './guest-voice-v2-facts'

const PERIOD = { startLocalDate: '2026-10-01', endLocalDate: '2026-10-31' } as const

function counted(
  id: string,
  localDate: string,
  over: Partial<{
    revision: number
    sequence: number
    hasText: boolean
    rating: 1 | 2 | 3 | 4 | 5
  }> = {},
) {
  return {
    reviewId: id as never,
    sourceRevision: over.revision ?? 1,
    analysisSequence: over.sequence ?? 1,
    localDate,
    hasText: over.hasText ?? true,
    rating: over.rating ?? (5 as const),
  }
}

function analysed(
  id: string,
  localDate: string,
  over: Partial<GuestVoiceReview> = {},
): GuestVoiceReview {
  return {
    reviewId: id,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 1,
    localDate,
    rating: 5,
    urgentReason: null,
    mentions: [],
    ...over,
  }
}

describe('reviewVersionKey', () => {
  it('names a review by its id, revision and analysis sequence', () => {
    expect(
      reviewVersionKey({ reviewId: 'r', sourceRevision: 2, analysisSequence: 3 }),
    ).toBe('r:2:3')
  })
})

describe('joinPeriod', () => {
  it('counts a review when Review and the analysis agree on its version and day', () => {
    const joined = joinPeriod(
      PERIOD,
      [
        counted('a', '2026-10-05', { rating: 2 }),
        counted('b', '2026-10-06', { hasText: false }),
      ],
      [analysed('a', '2026-10-05', { rating: 2 })],
      [],
    )

    expect(joined.analysed.map((review) => review.reviewId)).toEqual(['a'])
    expect(joined.population).toEqual({ stars: [0, 1, 0, 0, 1], textReviews: 1 })
    expect(joined.awaitingAnalysis).toBe(0)
  })

  it('does not count an analysis of a version Review no longer holds, or of another day', () => {
    const joined = joinPeriod(
      PERIOD,
      [counted('a', '2026-10-05', { revision: 2 }), counted('b', '2026-10-06')],
      [
        analysed('a', '2026-10-05', { sourceRevision: 1 }),
        analysed('b', '2026-10-07'),
        analysed('gone', '2026-10-08'),
      ],
      [],
    )

    expect(joined.analysed).toEqual([])
    // Both reviews with text still wait for an analysis of what they say now.
    expect(joined.awaitingAnalysis).toBe(2)
  })

  it('leaves the days outside the period to the other period', () => {
    const joined = joinPeriod(
      PERIOD,
      [
        counted('a', '2026-09-30'),
        counted('b', '2026-10-01'),
        counted('c', '2026-11-01'),
      ],
      [
        analysed('a', '2026-09-30'),
        analysed('b', '2026-10-01'),
        analysed('c', '2026-11-01'),
      ],
      [],
    )

    expect(joined.analysed.map((review) => review.reviewId)).toEqual(['b'])
    expect(joined.population.textReviews).toBe(1)
  })

  it('does not wait on a review the analysis could not read', () => {
    const joined = joinPeriod(
      PERIOD,
      [counted('a', '2026-10-05'), counted('b', '2026-10-06')],
      [analysed('a', '2026-10-05')],
      [
        {
          reviewId: 'b',
          sourceRevision: 1,
          analysisSequence: 1,
          localDate: '2026-10-06',
        },
      ],
    )

    expect(joined.awaitingAnalysis).toBe(0)
    expect(joined.analysed).toHaveLength(1)
  })

  it('does not wait on a review with only stars', () => {
    const joined = joinPeriod(
      PERIOD,
      [counted('a', '2026-10-05', { hasText: false })],
      [],
      [],
    )

    expect(joined.awaitingAnalysis).toBe(0)
    expect(joined.population).toEqual({ stars: [0, 0, 0, 0, 1], textReviews: 0 })
  })
})
