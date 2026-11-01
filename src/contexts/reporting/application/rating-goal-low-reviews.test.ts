import { describe, expect, it } from 'vitest'
import { lowStarCount, thisWeekView } from './rating-goal-low-reviews'

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

describe('the low reviews counted since the set', () => {
  it('counts the reviews that gave 3★ or less', () => {
    // 1 + 2 + 3 reviews at 1★, 2★ and 3★; the 4★ and 5★ ones are not low.
    expect(lowStarCount(split([1, 2, 3, 4, 5]))).toBe(6)
  })

  it('counts a 3★ review as low and a 4★ review as not', () => {
    expect(lowStarCount(split([0, 0, 1, 0, 0]))).toBe(1)
    expect(lowStarCount(split([0, 0, 0, 1, 0]))).toBe(0)
  })

  it('counts none when every review gave 4★ or more', () => {
    expect(lowStarCount(split([0, 0, 0, 6, 9]))).toBe(0)
  })

  it('counts every review when all of them are low', () => {
    expect(lowStarCount(split([4, 3, 2, 0, 0]))).toBe(9)
  })

  it('counts none for a split without a single review', () => {
    expect(lowStarCount(split([0, 0, 0, 0, 0]))).toBe(0)
    expect(lowStarCount([])).toBe(0)
  })

  it('counts from the star levels it is given, however few it names', () => {
    expect(
      lowStarCount([
        { stars: 2, count: 3 },
        { stars: 5, count: 8 },
      ]),
    ).toBe(3)
  })
})
