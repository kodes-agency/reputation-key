import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  needExact,
  setbackOf,
  whatSetYouBack,
  type SetbackNumbers,
} from './rating-goal-setback'

// Harborline: goal 4.1 (shows from 4.05), planned 4.5★, set at 261 reviews
// summing 1,021. The plan counts as 15 reviews beside the new ones (PR C), so
// one review moves the average the goal assumes, and with it every count.
const harborline = (
  reviewCount: number,
  sum: number,
  sinceSet: Readonly<{ count: number; sum: number }>,
): SetbackNumbers => ({
  reviewCount,
  exact: ratio(sum, reviewCount),
  sinceSet,
  qualityTenths: 45,
  targetTenths: 41,
})

/** A setback as a decimal, for the golden rows of PLAN-D §2. */
const decimal = (value: ReturnType<typeof setbackOf>): number | null =>
  value === null ? null : Number(value.num) / Number(value.den)

describe('needExact', () => {
  it('is the un-ceiled count the headline rounds up', () => {
    // 261 × (4.05 − 3.9119) / (4.5 − 4.05) = 80.11: the setup's 81.
    expect(decimal(needExact(261, ratio(1021, 261), 4050, ratio(9, 2)))).toBeCloseTo(
      80.11,
      2,
    )
  })

  it('is nothing once the average clears the threshold', () => {
    expect(needExact(261, ratio(1060, 261), 4050, ratio(9, 2))).toEqual(ratio(0, 1))
  })

  it('has no count while new reviews do not clear the threshold', () => {
    expect(needExact(261, ratio(1021, 261), 4050, ratio(81, 20))).toBeNull()
  })
})

describe('setbackOf (PLAN-D §2 golden rows)', () => {
  it('sets the goal back about 50 for a 2★ first review', () => {
    // With it: blend 695/160 = 4.3438, need 129.70; without it: 4.5★, 80.11.
    const setback = setbackOf(harborline(262, 1023, { count: 1, sum: 2 }), 2)

    expect(decimal(setback)).toBeCloseTo(49.59, 2)
  })

  it('sets it back about 89 for a 1★ first review and about 24 for a 3★ one', () => {
    expect(
      decimal(setbackOf(harborline(262, 1022, { count: 1, sum: 1 }), 1)),
    ).toBeCloseTo(88.97, 2)
    expect(
      decimal(setbackOf(harborline(262, 1024, { count: 1, sum: 3 }), 3)),
    ).toBeCloseTo(24.03, 2)
  })

  it('counts the ninth review against the floor the blend is held at', () => {
    // Eight 4★ then a 1★: blend 4.1875 is held at 4.2 (need 263.33); without
    // the 1★ the blend is 4.3261 (need 132.02).
    const setback = setbackOf(harborline(270, 1054, { count: 9, sum: 33 }), 1)

    expect(decimal(setback)).toBeCloseTo(131.31, 2)
  })

  it('sets the goal back about 21 for a 2★ eleventh review', () => {
    // m 4.4423 (need 83.10) against 4.54 (need 62.35).
    const setback = setbackOf(harborline(272, 1069, { count: 11, sum: 48 }), 2)

    expect(decimal(setback)).toBeCloseTo(20.75, 2)
  })

  it('weighs each star of a 28th review, and a 5★ one moves the goal closer', () => {
    const at28 = harborline(289, 1150, { count: 28, sum: 129 })

    expect([1, 2, 3, 4, 5].map((stars) => decimal(setbackOf(at28, stars)))).toEqual([
      expect.closeTo(10.57, 2),
      expect.closeTo(7.67, 2),
      expect.closeTo(4.52, 2),
      expect.closeTo(1.09, 2),
      expect.closeTo(-2.66, 2),
    ])
  })

  it('has no setback while new reviews are too low for any count to reach the goal', () => {
    // Ten since the set average 4.0, at or below 4.05: the goal's own average.
    expect(setbackOf(harborline(271, 1061, { count: 10, sum: 40 }), 1)).toBeNull()
  })

  it('has no setback for a review the totals since the set do not hold', () => {
    expect(setbackOf(harborline(261, 1021, { count: 0, sum: 0 }), 2)).toBeNull()
    expect(setbackOf(harborline(262, 1023, { count: 1, sum: 1 }), 2)).toBeNull()
  })
})

describe('whatSetYouBack', () => {
  const review = (id: string, stars: number) => ({ id, stars })

  it('keeps the newest reviews that set the goal back about one or more, worded half up', () => {
    const at28 = harborline(289, 1150, { count: 28, sum: 129 })
    const rows = whatSetYouBack(at28, [review('a', 4), review('b', 1), review('c', 2)])

    expect(rows).toEqual([
      { id: 'a', stars: 4, setBack: 1 },
      { id: 'b', stars: 1, setBack: 11 },
      { id: 'c', stars: 2, setBack: 8 },
    ])
  })

  it('leaves out a review that sets the goal back less than half a review', () => {
    // 2,000 reviews at 4.04 and 400 since the set at 4.7: a 4★ review sits
    // just under 4.05 and adds about 0.16 to what 4.1 needs.
    const large = {
      reviewCount: 2000,
      exact: ratio(8080, 2000),
      sinceSet: { count: 400, sum: 1880 },
      qualityTenths: 47,
      targetTenths: 41,
    }
    expect(decimal(setbackOf(large, 4))).toBeCloseTo(0.157, 3)
    expect(whatSetYouBack(large, [review('a', 4)])).toEqual([])
  })

  it('lists the newest ten without a setback while no count reaches the goal', () => {
    const tooLow = harborline(271, 1061, { count: 10, sum: 40 })
    const reviews = Array.from({ length: 12 }, (_, index) => review(`r${index}`, 1))

    const rows = whatSetYouBack(tooLow, reviews)

    expect(rows).toHaveLength(10)
    expect(rows[0]).toEqual({ id: 'r0', stars: 1, setBack: null })
    expect(rows.at(-1)?.id).toBe('r9')
  })

  it('shows ten at most', () => {
    const at28 = harborline(289, 1150, { count: 28, sum: 129 })
    const reviews = Array.from({ length: 14 }, (_, index) => review(`r${index}`, 1))

    expect(whatSetYouBack(at28, reviews)).toHaveLength(10)
  })
})
