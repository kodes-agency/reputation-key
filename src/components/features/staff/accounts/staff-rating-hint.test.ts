import { it, expect } from 'vitest'
import { highRatingFromFewGuests, type StaffHintFigures } from './staff-rating-hint'
const person = (
  portalId: string,
  scans: number,
  ratings = 5,
  average = 4.5,
): StaffHintFigures => ({ portalId, scans, ratings, average })
it('marks a high average strictly below half the median scans', () => {
  expect([
    ...highRatingFromFewGuests([person('a', 9), person('b', 20), person('c', 30)]),
  ]).toEqual(['a'])
  expect([
    ...highRatingFromFewGuests([person('a', 10), person('b', 20), person('c', 30)]),
  ]).toEqual([])
})
it('enforces staff, sample and average minimums', () => {
  expect(highRatingFromFewGuests([person('a', 1), person('b', 30)]).size).toBe(0)
  expect(
    highRatingFromFewGuests([person('a', 1, 4), person('b', 30), person('c', 30)]).size,
  ).toBe(0)
  expect(
    highRatingFromFewGuests([person('a', 1, 5, 4.49), person('b', 30), person('c', 30)])
      .size,
  ).toBe(0)
})
it('uses the middle pair for an even roster and withholds unknown scans', () => {
  expect([
    ...highRatingFromFewGuests([
      person('a', 12),
      person('b', 20),
      person('c', 30),
      person('d', 40),
    ]),
  ]).toEqual(['a'])
  expect(
    highRatingFromFewGuests([
      person('a', 1),
      person('b', 30),
      { ...person('c', 30), scans: null },
    ]).size,
  ).toBe(0)
})
