// The detail page of the Google rating goal, worked out (round 5, mock D3): the
// sentences under the headline, the tiles of "Your plan, so far" and how fresh
// Google's numbers are.
import { describe, expect, it } from 'vitest'
import {
  detailHeaderLines,
  freshnessText,
  planSoFarTiles,
} from './rating-goal-detail-view'
import {
  DETAIL_GOOGLE_SOURCE,
  DETAIL_HARBORLINE,
  DETAIL_LAGS,
  DETAIL_LAGS_MIDDLE,
  DETAIL_OLD_GOAL,
  DETAIL_TOO_LOW,
} from './rating-goal-detail.stories.fixtures'
import { DETAIL_BEFORE_TEN } from './rating-goal-plan.stories.fixtures'
import { CARD_ACTUAL_PACE } from './rating-goal-tracking.stories.fixtures'

describe('the header’s sentences', () => {
  it('says when at the card’s pace, where Google stands and what is possible after', () => {
    expect(detailHeaderLines(DETAIL_HARBORLINE)).toEqual({
      arrival: '4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks.',
      started: 'Google shows 4.0 today, up from 3.9 when you started.',
      possible: '4.2 is possible in about 3 months.',
      otherPace: null,
    })
  })

  it('gives the chosen pace’s time too once the goal works at its actual pace', () => {
    const lines = detailHeaderLines({
      ...DETAIL_HARBORLINE,
      ...CARD_ACTUAL_PACE,
      // 27 in the last 28 days against 1 a day: the times read alike.
      forecastAtChosenPace: {
        kind: 'days',
        central: { num: 63, den: 1 },
        fast: { num: 50, den: 1 },
        slow: null,
      },
    })

    expect(lines.arrival).toBe(
      '4.1 in about 3 weeks at your pace of the last 4 weeks, likely 2–4 weeks.',
    )
    expect(lines.otherPace).toBe('At your 1 a day: in about 9 weeks.')
    expect(
      detailHeaderLines({ ...DETAIL_HARBORLINE, ...CARD_ACTUAL_PACE }).otherPace,
    ).toBeNull()
  })

  it('says Google shows what it showed at the set, as when you started', () => {
    expect(
      detailHeaderLines({
        ...DETAIL_HARBORLINE,
        google: { ...DETAIL_HARBORLINE.google!, shows: 3.9 },
      }).started,
    ).toBe('Google shows 3.9 today, as when you started.')
  })

  it('gives no time while Google should show the goal soon or new reviews are too low', () => {
    expect(detailHeaderLines(DETAIL_LAGS)).toMatchObject({
      arrival: null,
      possible: null,
    })
    expect(detailHeaderLines(DETAIL_TOO_LOW)).toMatchObject({
      arrival: null,
      possible: null,
    })
  })

  it('says nothing more of a goal the read found reached', () => {
    expect(detailHeaderLines({ ...DETAIL_HARBORLINE, state: 'reached' })).toEqual({
      arrival: null,
      started: null,
      possible: null,
      otherPace: null,
    })
  })

  it('says nothing of today while Google’s numbers are stale', () => {
    const stale = { ...DETAIL_HARBORLINE.google!, current: false }

    expect(detailHeaderLines({ ...DETAIL_HARBORLINE, google: stale }).started).toBeNull()
  })
})

describe('your plan, so far', () => {
  it('sets the pace, the new reviews’ average and the steps against the plan', () => {
    expect(planSoFarTiles(DETAIL_HARBORLINE)).toEqual([
      {
        label: 'Pace',
        value: '1 a day · plan 1 a day',
        detail: 'Last 4 weeks · up from about 2 a month before the goal',
      },
      {
        label: 'New reviews average',
        value: '4.57★ · plan 4.5★',
        detail:
          '35 reviews since the goal was set · forecasts use 4.55★, your plan mixed with them',
      },
      {
        label: 'Steps',
        value: '4.0 reached · 4.1 next',
        detail: 'After 4.1: 4.2 is about 80 more',
      },
    ])
  })

  it('says the pace was the same before the goal, or leaves it out when unknown', () => {
    expect(planSoFarTiles(DETAIL_LAGS_MIDDLE)[0]?.detail).toBe(
      'Last 4 weeks · about 30 a month before the goal too',
    )
    expect(planSoFarTiles(DETAIL_OLD_GOAL)[0]?.detail).toBe('Last 4 weeks')
  })

  it('gives no average before ten reviews, and says the numbers use theirs while too low', () => {
    expect(planSoFarTiles(DETAIL_BEFORE_TEN)[1]).toEqual({
      label: 'New reviews average',
      value: 'after 10 reviews · plan 4.5★',
      detail:
        '4 reviews since the goal was set · forecasts use 4.55★, your plan mixed with them',
    })
    expect(
      planSoFarTiles({
        ...DETAIL_TOO_LOW,
        plan: {
          ...DETAIL_TOO_LOW.plan!,
          sinceSet: { reviewCount: 12, average: 3.75, averageTenths: 38 },
          qualityBasis: 'since_set',
        },
      })[1],
    ).toMatchObject({
      value: '3.75★ · plan 4.5★',
      detail: '12 reviews since the goal was set · the numbers use their average',
    })
  })

  it('names only the next step until Google shows more than at the set', () => {
    expect(
      planSoFarTiles({
        ...DETAIL_HARBORLINE,
        planSoFar: { ...DETAIL_HARBORLINE.planSoFar, reachedTenths: null },
      })[2]?.value,
    ).toBe('4.1 next')
    expect(planSoFarTiles(DETAIL_GOOGLE_SOURCE)).toHaveLength(3)
  })

  it('has no tiles for a goal without a plan', () => {
    expect(planSoFarTiles({ ...DETAIL_HARBORLINE, plan: null })).toEqual([])
  })
})

describe('the foot', () => {
  it('says how long ago Google’s numbers were checked', () => {
    const readAt = new Date('2026-10-14T12:00:00.000Z')

    expect(freshnessText('2026-10-14T11:48:00.000Z', readAt)).toBe(
      'Google numbers checked 12 minutes ago',
    )
    expect(freshnessText('2026-10-14T11:59:40.000Z', readAt)).toBe(
      'Google numbers checked just now',
    )
    expect(freshnessText('2026-10-14T07:00:00.000Z', readAt)).toBe(
      'Google numbers checked 5 hours ago',
    )
    expect(freshnessText('2026-10-11T12:00:00.000Z', readAt)).toBe(
      'Google numbers checked 3 days ago',
    )
  })
})
