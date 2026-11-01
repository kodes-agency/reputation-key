// What the Google rating goal's page says about its new reviews (2026-11-01, ADR 0067):
// "Are enough good reviews coming in?", what they average and how many were low (3★ or
// less, whatever the goal needs). The row that opens a low review is
// `rating-goal-low-review-view.test.ts`, the bars of each week against the plan
// `rating-goal-week-bars.test.ts`.
import { describe, expect, it } from 'vitest'
import { lowFact, reviewsBand, starsFact } from './rating-goal-review-facts-view'
import { DETAIL_HARBORLINE, DETAIL_TOO_LOW } from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_BELOW_PACE,
  DETAIL_JUST_SET,
  DETAIL_KEEP,
} from './rating-goal-detail-states.stories.fixtures'
import {
  DETAIL_FOUND_ENDED,
  DETAIL_FOUND_REACHED,
} from './rating-goal-detail-outcomes.stories.fixtures'

type Detail = Parameters<typeof reviewsBand>[0]

/** The detail with the new reviews of the last four weeks, a decimal a week. */
const lately = (detail: Detail, lastFourWeeksPerWeek: number): Detail => ({
  ...detail,
  lastFourWeeksPerWeek,
})

/** The detail with the pace of the weeks before the goal changed (null: the chart does not reach them). */
const before = (detail: Detail, prePlan: Detail['planSoFar']['prePlan']): Detail => ({
  ...detail,
  planSoFar: { prePlan },
})

/** The detail with the reviews since the set counted again: how many, and their average. */
const sinceSet = (
  detail: Detail,
  reviewCount: number,
  average: number | null,
): Detail => ({
  ...detail,
  plan: {
    ...detail.plan!,
    sinceSet: {
      reviewCount,
      average,
      averageTenths: average === null ? null : Math.round(average * 10),
    },
  },
})

describe('are enough good reviews coming in?', () => {
  it('says yes, at the pace of the last four weeks, and what was planned', () => {
    expect(reviewsBand(DETAIL_HARBORLINE)).toEqual({
      title: 'Are enough good reviews coming in?',
      icon: 'reviews',
      answer: 'Yes, about 7 a week',
      hint: 'You planned 1 a day. Before the goal it was about 2 a month.',
      tone: 'positive',
    })
  })

  it('says what was planned alone when the chart does not reach the weeks before the goal', () => {
    expect(reviewsBand(before(DETAIL_HARBORLINE, null)).hint).toBe('You planned 1 a day.')
  })

  it('says that none came in the four weeks before the goal rather than about 0 a month', () => {
    const none = before(DETAIL_HARBORLINE, { perMonth: 0, trend: 'same' })

    expect(reviewsBand(none).hint).toBe(
      'You planned 1 a day. There were none in the 4 weeks before the goal.',
    )
  })

  it('says a plan under a day by the week', () => {
    const slow = { ...DETAIL_HARBORLINE, paceTenthsPerWeek: 20 }

    expect(reviewsBand(slow).hint).toBe(
      'You planned 2 a week. Before the goal it was about 2 a month.',
    )
  })

  it('says not enough, and how many a week it is, when the goal is behind its pace', () => {
    expect(reviewsBand(DETAIL_BELOW_PACE)).toEqual({
      title: 'Are enough good reviews coming in?',
      icon: 'reviews',
      answer: 'Not enough: about 4 a week',
      hint: 'You planned 7 a week.',
      tone: 'warn',
    })
  })

  it.each([
    [0, 'Not enough: none lately'],
    [0.4, 'Not enough: under 1 a week'],
    [1, 'Not enough: about 1 a week'],
    [10.5, 'Not enough: about 11 a week'],
    [1234, 'Not enough: about 1,234 a week'],
  ])('says the pace of %f a week as “%s”', (perWeek, answer) => {
    expect(reviewsBand(lately({ ...DETAIL_BELOW_PACE }, perWeek)).answer).toBe(answer)
  })

  it('says it is too early to say while the goal is new, and what to aim for', () => {
    expect(reviewsBand(DETAIL_JUST_SET)).toEqual({
      title: 'Are enough good reviews coming in?',
      icon: 'reviews',
      answer: 'Too early to say',
      hint: 'Aim for about 7 a week. Before the goal it was about 2 a month.',
      tone: 'neutral',
    })
  })

  it('says what to aim for alone when there is no pace before the goal to compare', () => {
    expect(reviewsBand(before(DETAIL_JUST_SET, null)).hint).toBe(
      'Aim for about 7 a week.',
    )
  })

  it('says it is too early to say while the goal is getting started, though not new', () => {
    expect(reviewsBand({ ...DETAIL_JUST_SET, justSet: false }).answer).toBe(
      'Too early to say',
    )
  })

  it('waits for the stars: a plan alone, at the pace of the last four weeks, for a goal that waits for Google', () => {
    const waiting = { ...DETAIL_HARBORLINE, status: 'waiting_for_google' as const }

    expect(reviewsBand(waiting)).toEqual({
      title: 'Are enough good reviews coming in?',
      icon: 'reviews',
      answer: 'About 7 a week',
      hint: 'You planned 7 a week.',
      tone: 'neutral',
    })
  })
})

describe('are enough good reviews coming in, with the stars too low', () => {
  it('says enough, but the stars are low, with their average and the plan’s', () => {
    expect(reviewsBand(DETAIL_TOO_LOW)).toEqual({
      title: 'Are enough good reviews coming in?',
      icon: 'reviews',
      answer: 'Enough, but the stars are low',
      hint: 'About 7 a week at 3.8★. You planned 7 a week at 4.5★.',
      tone: 'warn',
    })
  })

  it('says not enough, and the stars are low, when the reviews are too few as well', () => {
    expect(reviewsBand(lately(DETAIL_TOO_LOW, 2)).answer).toBe(
      'Not enough, and the stars are low',
    )
  })

  it('counts a pace of nine tenths of the plan as enough, and a little less as not', () => {
    // The plan is 7 a week, so 6.3 is its nine tenths.
    expect(reviewsBand(lately(DETAIL_TOO_LOW, 6.3)).answer).toBe(
      'Enough, but the stars are low',
    )
    expect(reviewsBand(lately(DETAIL_TOO_LOW, 6.2)).answer).toBe(
      'Not enough, and the stars are low',
    )
  })

  it('leaves their average out until there are ten of them', () => {
    expect(reviewsBand(sinceSet(DETAIL_TOO_LOW, 8, null)).hint).toBe(
      'About 7 a week. You planned 7 a week at 4.5★.',
    )
  })

  it('opens the words with “none lately” or “under 1 a week” in a capital', () => {
    expect(reviewsBand(lately(DETAIL_TOO_LOW, 0)).hint).toMatch(
      /^None lately at 3\.8★\./u,
    )
    expect(reviewsBand(lately(DETAIL_TOO_LOW, 0.4)).hint).toMatch(
      /^Under 1 a week at 3\.8★\./u,
    )
  })
})

describe('what came in, once the goal is over', () => {
  it('asks what got you there, and answers with the new reviews and their average, for a goal reached', () => {
    expect(reviewsBand(DETAIL_FOUND_REACHED)).toEqual({
      title: 'What got you there?',
      icon: 'reviews',
      answer: '27 new reviews at 4.6★',
      hint: 'Before the goal it was about 2 a month.',
      tone: 'positive',
    })
  })

  it('asks what came in, in a neutral tone, for a goal that ended', () => {
    expect(reviewsBand(DETAIL_FOUND_ENDED)).toMatchObject({
      title: 'What came in?',
      answer: '27 new reviews at 4.6★',
      tone: 'neutral',
    })
  })

  it('counts the reviews alone before there are ten to average', () => {
    expect(reviewsBand(sinceSet(DETAIL_FOUND_ENDED, 8, null)).answer).toBe(
      '8 new reviews',
    )
    expect(reviewsBand(sinceSet(DETAIL_FOUND_ENDED, 1, null)).answer).toBe('1 new review')
  })

  it('counts none when the read found no plan', () => {
    expect(reviewsBand({ ...DETAIL_FOUND_ENDED, plan: null }).answer).toBe(
      '0 new reviews',
    )
  })

  it('has nothing to say of before the goal when the chart does not reach it', () => {
    expect(reviewsBand(before(DETAIL_FOUND_REACHED, null)).hint).toBeNull()
  })
})

describe('what the new reviews average', () => {
  it('says what they average and what was planned, once there are ten', () => {
    expect(starsFact(DETAIL_HARBORLINE)).toBe('They average 4.6★. You planned 4.5★.')
  })

  it('rounds their average to the tenth Google prints', () => {
    expect(starsFact(sinceSet(DETAIL_HARBORLINE, 40, 4.549))).toBe(
      'They average 4.5★. You planned 4.5★.',
    )
  })

  it('says it will compare the stars after ten new reviews until then', () => {
    expect(starsFact(DETAIL_JUST_SET)).toBe(
      'We’ll compare their stars with your 4.5★ after 10 new reviews.',
    )
    expect(starsFact(sinceSet(DETAIL_HARBORLINE, 9, null))).toBe(
      'We’ll compare their stars with your 4.5★ after 10 new reviews.',
    )
  })

  it('says nothing for a goal to keep a number, which has no plan to compare with', () => {
    expect(starsFact(DETAIL_KEEP)).toBeNull()
  })

  it('says nothing when the read found no plan', () => {
    expect(starsFact({ ...DETAIL_HARBORLINE, plan: null })).toBeNull()
  })
})

describe('how many new reviews were low', () => {
  const low = (detail: Detail, count: number, lowSinceSet: number | null): Detail => ({
    ...sinceSet(detail, count, count >= 10 ? 4.2 : null),
    moved: { ...detail.moved, lowSinceSet },
  })

  it('says none were, of all the new reviews', () => {
    expect(lowFact(DETAIL_HARBORLINE)).toBe('None of the 27 new reviews gave 3★ or less.')
  })

  it('says how many were, of all the new reviews', () => {
    expect(lowFact(low(DETAIL_HARBORLINE, 52, 4))).toBe(
      '4 of the 52 new reviews gave 3★ or less.',
    )
  })

  it('says one low review in the same words, and writes a thousand with its separator', () => {
    expect(lowFact(low(DETAIL_HARBORLINE, 52, 1))).toBe(
      '1 of the 52 new reviews gave 3★ or less.',
    )
    expect(lowFact(low(DETAIL_HARBORLINE, 1200, 30))).toBe(
      '30 of the 1,200 new reviews gave 3★ or less.',
    )
  })

  it('says it from two new reviews, and says nothing from fewer than two', () => {
    expect(lowFact(low(DETAIL_HARBORLINE, 2, 1))).toBe(
      '1 of the 2 new reviews gave 3★ or less.',
    )
    expect(lowFact(low(DETAIL_HARBORLINE, 1, 1))).toBeNull()
    expect(lowFact(low(DETAIL_HARBORLINE, 0, 0))).toBeNull()
  })

  it('says nothing when the read did not count them (a goal to keep, or one that is over)', () => {
    expect(lowFact(low(DETAIL_HARBORLINE, 52, null))).toBeNull()
    expect(lowFact(DETAIL_KEEP)).toBeNull()
  })

  it('says nothing when the read found no plan', () => {
    expect(lowFact({ ...DETAIL_HARBORLINE, plan: null })).toBeNull()
  })
})
