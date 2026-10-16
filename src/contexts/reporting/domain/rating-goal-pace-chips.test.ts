import { describe, expect, it } from 'vitest'
import { ratio } from './rating-goal-numbers'
import {
  A_FEW_A_WEEK_TENTHS,
  OWN_PACE_MIN_TENTHS,
  dayTenthsOf,
  nowPerMonth,
  ownPaceTenths,
  paceChips,
  perMonthOf,
  provenPacePerDay,
} from './rating-goal-pace-chips'

const tenthsOf = (chips: ReturnType<typeof paceChips>) =>
  chips.chips.map((chip) => chip.tenthsPerWeek)

describe('the proven pace a day', () => {
  it('is the busier of the last 90 days and the busiest 30 days, exactly', () => {
    expect(provenPacePerDay(104, 46)).toEqual(ratio(46, 30))
    expect(provenPacePerDay(6, 3)).toEqual(ratio(1, 10))
    expect(provenPacePerDay(90, 20)).toEqual(ratio(1, 1))
  })

  it('is nothing for a Property with no reviews', () => {
    expect(provenPacePerDay(0, 0)).toEqual(ratio(0, 1))
  })
})

describe('the pace chips', () => {
  it('offer a few a week, then 1, 2, 3 and 5 a day to a quiet Property, 1 a day recommended', () => {
    const chips = paceChips(6, 3)
    expect(tenthsOf(chips)).toEqual([A_FEW_A_WEEK_TENTHS, 70, 140, 210, 350])
    expect(chips.chips[0]?.kind).toBe('a_few_a_week')
    expect(chips.recommendedIndex).toBe(1)
    expect(chips.busiest30).toBe(3)
  })

  it('offer a busy Property its busiest month, the recommendation and three above (Seaview)', () => {
    const chips = paceChips(104, 46)
    expect(tenthsOf(chips)).toEqual([107, 140, 210, 350, 490])
    expect(chips.chips[0]?.kind).toBe('busiest_month')
    expect(chips.recommendedIndex).toBe(1)
  })

  it('recommend 7 a day to a restaurant with 152 in its busiest month (Tavola)', () => {
    expect(tenthsOf(paceChips(444, 152))).toEqual([355, 490, 700, 1050, 1400])
  })

  it.each([
    // proven a day, as the busiest 30 days → the recommendation a day
    [40, 2], // 1.33 × 1.5 = 2.0
    [69, 3], // 2.3 × 1.5 = 3.45
    [80, 5], // 2.67 × 1.5 = 4.0, a tie between 3 and 5 goes up
    [150, 7], // 5.0 × 1.5 = 7.5, nearer 7 than 10
  ])(
    'recommend the nice pace nearest one and a half times the proven one (%i in 30 days)',
    (busiest, perDay) => {
      expect(paceChips(0, busiest).chips[1]?.tenthsPerWeek).toBe(perDay * 70)
    },
  )

  it('never recommend more than 50 a day, and drop the busiest month when it is that busy', () => {
    const chips = paceChips(0, 1800)
    expect(tenthsOf(chips)).toEqual([3500])
    expect(chips.recommendedIndex).toBe(0)
  })

  it('keep fewer than three above the recommendation near 50 a day', () => {
    expect(tenthsOf(paceChips(0, 780))).toEqual([1820, 2100, 3500])
  })
})

describe('a pace in other words', () => {
  it.each([
    [105, 15],
    [107, 15],
    [355, 51],
    [70, 10],
    [14, 2],
  ])('words %i tenths a week as %i tenths a day, half up', (week, day) => {
    expect(dayTenthsOf(week)).toBe(day)
  })

  it.each([
    [70, 30],
    [46, 20],
    [14, 6],
    [490, 210],
    [1050, 460],
  ])('words %i tenths a week as a nice %i a month (30.4 days)', (week, month) => {
    expect(perMonthOf(week)).toBe(month)
  })

  it.each([
    [6, 2],
    [15, 5],
    [104, 35],
    [444, 150],
  ])('counts %i reviews in 90 days as about %i a month now', (reviews, month) => {
    expect(nowPerMonth(reviews)).toBe(month)
  })
})

describe('a pace the manager types', () => {
  it.each([
    [0.2, 14],
    [1.5, 105],
    [50, 3500],
    [2, 140],
  ])('takes %f a day as %i tenths a week', (perDay, tenths) => {
    expect(ownPaceTenths('day', perDay)).toEqual({ tenths, clamped: null })
  })

  it.each([20, 35, 150, 7])('takes %i a month and words it back the same', (month) => {
    const own = ownPaceTenths('month', month)
    expect(own.clamped).toBeNull()
    expect(perMonthOf(own.tenths)).toBe(month)
  })

  it('clamps below 0.2 a day and above 50 a day, and says which', () => {
    expect(OWN_PACE_MIN_TENTHS).toBe(14)
    expect(ownPaceTenths('day', 0.1)).toEqual({ tenths: 14, clamped: 'low' })
    expect(ownPaceTenths('day', 80)).toEqual({ tenths: 3500, clamped: 'high' })
    expect(ownPaceTenths('month', 1)).toEqual({ tenths: 14, clamped: 'low' })
    expect(ownPaceTenths('month', 2000)).toEqual({ tenths: 3500, clamped: 'high' })
  })

  it('takes nothing readable as the lowest pace, clamped', () => {
    expect(ownPaceTenths('day', null)).toEqual({ tenths: 14, clamped: 'low' })
    expect(ownPaceTenths('month', Number.NaN)).toEqual({ tenths: 14, clamped: 'low' })
  })
})
