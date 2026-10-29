import { describe, expect, it } from 'vitest'
import {
  starsOfMentioned,
  type RatingCounts,
} from '#/contexts/ai/application/aspect-review-evidence'
import type { AiAspectAggregate } from '#/contexts/ai/application/public-api'
import { topComplaint, topicCountText, topPraise } from './overview-guest-voice-topics'

const WINDOW = { ratingCounts: [4, 3, 5, 10, 18], reviewCount: 40 } as const

function topic(
  aspect: AiAspectAggregate['aspect'],
  polarity: AiAspectAggregate['polarity'],
  ratingCounts: RatingCounts,
): AiAspectAggregate {
  const reviewCount = ratingCounts.reduce((total, count) => total + count, 0)
  return {
    aspect,
    polarity,
    mentionCount: reviewCount,
    reviewCount,
    ratingCounts,
    stars: starsOfMentioned(ratingCounts, WINDOW),
    impact: 0,
  }
}

describe('topComplaint', () => {
  it('is the complaint with the most stars at stake, not the one named most', () => {
    const parking = topic('parking', 'negative', [0, 1, 2, 3, 3])
    const checkIn = topic('check_in_out', 'negative', [3, 1, 0, 0, 0])

    expect(parking.reviewCount).toBeGreaterThan(checkIn.reviewCount)
    expect(topComplaint([parking, checkIn])?.aspect).toBe('check_in_out')
    expect(topComplaint([checkIn, parking])?.aspect).toBe('check_in_out')
  })

  it('prefers a complaint that was weighed to one with too few reviews to weigh', () => {
    const weighedAtNothing = topic('parking', 'negative', [0, 0, 1, 1, 1])
    const tooFew = topic('noise', 'negative', [2, 0, 0, 0, 0])

    expect(weighedAtNothing.stars.upTo).toBe(0)
    expect(tooFew.stars.upTo).toBeNull()
    expect(topComplaint([tooFew, weighedAtNothing])?.aspect).toBe('parking')
  })

  it('falls back to the most reviews when none was weighed', () => {
    expect(
      topComplaint([
        topic('noise', 'negative', [1, 0, 0, 0, 0]),
        topic('parking', 'negative', [1, 1, 0, 0, 0]),
      ])?.aspect,
    ).toBe('parking')
  })

  it('is nothing when no review complains', () => {
    expect(topComplaint([topic('staff', 'positive', [0, 0, 0, 3, 8])])).toBeUndefined()
    expect(topComplaint([topic('noise', 'negative', [0, 0, 0, 0, 0])])).toBeUndefined()
  })
})

describe('topPraise', () => {
  it('is the topic most reviews praise', () => {
    expect(
      topPraise([
        topic('room', 'positive', [0, 0, 0, 2, 3]),
        topic('staff', 'positive', [0, 0, 0, 3, 8]),
        topic('noise', 'negative', [3, 3, 3, 0, 0]),
      ])?.aspect,
    ).toBe('staff')
  })
})

describe('topicCountText', () => {
  it('leads with the topic and counts its reviews of the reviews read for topics', () => {
    expect(topicCountText(topic('staff', 'positive', [0, 0, 0, 3, 8]), 40)).toBe(
      'Staff, 11 of 40 reviews',
    )
  })

  it('says review for one', () => {
    expect(topicCountText(topic('room', 'negative', [1, 0, 0, 0, 0]), 1)).toBe(
      'Room, 1 of 1 review',
    )
  })
})
