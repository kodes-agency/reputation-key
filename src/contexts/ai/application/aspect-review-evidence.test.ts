import { describe, expect, it } from 'vitest'
import {
  changeOfMentions,
  ratingCountsOf,
  starsOfMentioned,
  type RatingCounts,
} from './aspect-review-evidence'

describe('ratingCountsOf', () => {
  it('files a rating under the stars it counts as: whole, from 1 to 5', () => {
    expect(ratingCountsOf([{ rating: 0 }, { rating: 9 }, { rating: 3.6 }])).toEqual([
      1, 0, 0, 1, 1,
    ])
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
  it('is unknown when the window holds under ten reviews to compare', () => {
    expect(
      changeOfMentions(
        { reviewCount: 5, textReviews: 8 },
        { reviewCount: 5, textReviews: 40 },
      ),
    ).toBe('unknown')
  })

  it('is unknown when the previous 12 months hold under twenty analysed reviews', () => {
    expect(
      changeOfMentions(
        { reviewCount: 12, textReviews: 20 },
        { reviewCount: 1, textReviews: 19 },
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
