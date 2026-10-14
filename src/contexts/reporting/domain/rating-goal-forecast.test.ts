import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  FORECAST_HORIZON_WEEKS,
  forecastArrival,
  monthKeyAt,
  weeksToReach,
} from './rating-goal-forecast'

const SOFIA = 'Europe/Sofia'
const NOW = new Date('2026-10-14T12:00:00.000Z')
const EXAMPLE = {
  reviewCount: 812,
  exact: ratio(431, 100),
  mix: ratio(470, 100),
  now: NOW,
  timezone: SOFIA,
}

describe('when a target is expected', () => {
  it('spans the months of mix ± 0.1 and pace ± 10% for the next tenth', () => {
    // Early: 73 reviews at 4.80 and 12.1 a week ≈ 6.0 weeks (25 Nov).
    // Late: 130 reviews at 4.60 and 9.9 a week ≈ 13.1 weeks (13 Jan).
    expect(
      forecastArrival({
        ...EXAMPLE,
        thresholdThousandths: 4350,
        pacePerWeek: ratio(11, 1),
      }),
    ).toEqual({ kind: 'range', fromMonth: '2026-11', toMonth: '2027-01' })
  })

  it('reaches out a year and a half for the Stretch target', () => {
    // Early: 325 reviews ≈ 26.9 weeks (20 Apr 2027). Late: 758 ≈ 76.6 weeks (2 Apr 2028).
    expect(
      forecastArrival({
        ...EXAMPLE,
        thresholdThousandths: 4450,
        pacePerWeek: ratio(11, 1),
      }),
    ).toEqual({ kind: 'range', fromMonth: '2027-04', toMonth: '2028-04' })
  })

  it('leaves the late end open when the mix less 0.1 no longer clears the threshold', () => {
    expect(
      forecastArrival({
        ...EXAMPLE,
        mix: ratio(462, 100),
        thresholdThousandths: 4550,
        pacePerWeek: ratio(11, 1),
      }),
    ).toMatchObject({ kind: 'range', toMonth: null })
  })

  it('says no pace reaches a target the recent mix does not clear', () => {
    expect(
      forecastArrival({
        ...EXAMPLE,
        thresholdThousandths: 4750,
        pacePerWeek: ratio(14, 1),
      }),
    ).toEqual({ kind: 'unreachable' })
  })

  it('has no date at a pace of zero', () => {
    expect(
      forecastArrival({
        ...EXAMPLE,
        thresholdThousandths: 4350,
        pacePerWeek: ratio(0, 1),
      }),
    ).toEqual({ kind: 'no_pace' })
  })

  it('stops at the horizon instead of naming a month decades away', () => {
    expect(
      forecastArrival({
        ...EXAMPLE,
        mix: ratio(4551, 1000),
        thresholdThousandths: 4550,
        pacePerWeek: ratio(1, 1),
      }),
    ).toEqual({ kind: 'beyond_horizon' })
    expect(FORECAST_HORIZON_WEEKS).toBe(520)
  })

  it('names the month in the Property time zone, not in UTC', () => {
    // 22:30 UTC on 31 Oct is 00:30 on 1 Nov in Sofia.
    const lateOctober = new Date('2026-10-31T22:30:00.000Z')

    expect(
      forecastArrival({
        ...EXAMPLE,
        exact: ratio(446, 100),
        thresholdThousandths: 4450,
        pacePerWeek: ratio(3, 1),
        now: lateOctober,
      }),
    ).toEqual({ kind: 'range', fromMonth: '2026-11', toMonth: '2026-11' })
    expect(monthKeyAt(lateOctober, 'UTC')).toBe('2026-10')
  })
})

describe('weeks to reach a count of reviews', () => {
  it('divides the reviews by the weekly pace', () => {
    expect(weeksToReach(93, ratio(11, 1))).toBeCloseTo(8.45, 2)
    expect(weeksToReach(0, ratio(11, 1))).toBe(0)
    expect(weeksToReach(10, ratio(0, 1))).toBe(Number.POSITIVE_INFINITY)
  })
})
