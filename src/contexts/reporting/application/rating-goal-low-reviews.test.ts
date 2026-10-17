import { describe, expect, it } from 'vitest'
import { thisWeekView } from './rating-goal-low-reviews'

const split = (counts: readonly [number, number, number, number, number]) =>
  counts.map((count, index) => ({ stars: index + 1, count }))

describe('this week’s stars', () => {
  it('has no stars and no average without a review', () => {
    expect(thisWeekView(split([0, 0, 0, 0, 0]))).toEqual({
      count: 0,
      allStars: null,
      averageTenths: null,
    })
  })

  it('names the stars when every review has the same', () => {
    expect(thisWeekView(split([0, 0, 0, 1, 0]))).toEqual({
      count: 1,
      allStars: 4,
      averageTenths: 40,
    })
    expect(thisWeekView(split([0, 0, 0, 0, 2]))).toEqual({
      count: 2,
      allStars: 5,
      averageTenths: 50,
    })
  })

  it('gives the average of a mixed week as a tenth, half up', () => {
    // 5 + 5 + 4 = 14 over 3 = 4.667: 4.7.
    expect(thisWeekView(split([0, 0, 0, 1, 2]))).toEqual({
      count: 3,
      allStars: null,
      averageTenths: 47,
    })
    // 4 + 5 = 9 over 2 = 4.5 exactly: 4.5.
    expect(thisWeekView(split([0, 0, 0, 1, 1])).averageTenths).toBe(45)
    // 1 + 4 + 4 + 4 = 13 over 4 = 3.25: 3.3 (half up).
    expect(thisWeekView(split([1, 0, 0, 3, 0])).averageTenths).toBe(33)
  })
})
