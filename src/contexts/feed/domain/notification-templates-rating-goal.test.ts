// The copy of the five Google rating goal notices (ADR 0067; ADR 0046,
// amended 2026-10-14 and 2026-10-15). These sentences are the contract: each
// states the Property's own figures and never a review's rating.

import { describe, expect, it } from 'vitest'
import type { NotificationPayload } from './notification-payload'
import { notificationLink, renderNotification } from './notification-templates'

const AT = { propertyName: 'Riverside Hotel' } as const

const copy = (type: Parameters<typeof renderNotification>[0], p: NotificationPayload) => {
  const { title, body, detail, actionLabel, summary } = renderNotification(type, p)
  return { title, body, detail, actionLabel, summary }
}

describe('reached', () => {
  it('leads with what Google shows and offers the next goal', () => {
    expect(
      copy('goal.rating_reached', {
        ...AT,
        ratingShownTenths: 45,
        ratingTargetTenths: 45,
      }),
    ).toEqual({
      title: 'Google now shows 4.5 for Riverside Hotel: goal reached',
      body: 'Set your next goal.',
      detail: '',
      actionLabel: 'Set next goal',
      summary: 'Riverside Hotel · Google rating goal reached',
    })
  })

  it('offers to keep the number from 4.7 (X1; R2-9 said 4.9)', () => {
    const reached = (tenths: number) =>
      copy('goal.rating_reached', {
        ...AT,
        ratingShownTenths: tenths,
        ratingTargetTenths: tenths,
      }).body

    expect(reached(46)).toBe('Set your next goal.')
    expect(reached(47)).toBe('Set your next goal, or keep 4.7.')
    expect(reached(48)).toBe('Set your next goal, or keep 4.8.')
    expect(reached(49)).toBe('Set your next goal, or keep 4.9.')
    expect(reached(50)).toBe('Set your next goal, or keep 5.0.')
  })

  it('still says the goal was reached without its figures', () => {
    expect(copy('goal.rating_reached', {})).toMatchObject({
      title: 'Google rating goal reached',
      body: 'Set your next goal.',
    })
  })
})

describe('a tenth gained or lost', () => {
  const changed = { ...AT, ratingTargetTenths: 45, ratingGoalMode: 'climb' } as const

  it('says up or down from what Google showed, and what the goal is', () => {
    expect(
      copy('goal.rating_changed', {
        ...changed,
        ratingShownTenths: 44,
        ratingPreviousTenths: 43,
      }),
    ).toEqual({
      title: 'Google now shows 4.4 for Riverside Hotel, up from 4.3',
      body: 'Your goal is 4.5.',
      detail: 'Your goal is 4.5.',
      actionLabel: 'View goal',
      summary: 'Riverside Hotel · Google rating changed',
    })
    expect(
      copy('goal.rating_changed', {
        ...changed,
        ratingShownTenths: 44,
        ratingPreviousTenths: 45,
      }).title,
    ).toBe('Google now shows 4.4 for Riverside Hotel, down from 4.5')
  })

  it('names the tenth a keep goal keeps', () => {
    expect(
      copy('goal.rating_changed', {
        ...changed,
        ratingGoalMode: 'keep',
        ratingShownTenths: 46,
        ratingPreviousTenths: 45,
      }).body,
    ).toBe('You’re keeping 4.5.')
  })

  it('states a coalesced row’s latest change only', () => {
    expect(
      renderNotification('goal.rating_changed', {
        ...changed,
        ratingShownTenths: 44,
        ratingPreviousTenths: 45,
        occurrences: 3,
      }).body,
    ).toBe('Your goal is 4.5.')
  })
})

describe('entered Below pace', () => {
  const below = { ...AT, ratingTargetTenths: 45, ratingPacePerWeek: 11 } as const

  it('says the pace of the last four weeks against the goal’s', () => {
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingRecentPaceTenths: 60,
        ratingPaceWindow: 'last_4_weeks',
      }),
    ).toEqual({
      title: 'Riverside Hotel is below its Google review pace',
      body: '6 new reviews a week over the last 4 weeks; the goal’s pace is 11 a week.',
      detail: '6 new reviews a week over the last 4 weeks; the goal’s pace is 11 a week.',
      actionLabel: 'View goal',
      summary: 'Riverside Hotel · below the review pace',
    })
  })

  it('keeps a tenth where it matters, and counts since the set for a young goal', () => {
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingPacePerWeek: 2,
        ratingRecentPaceTenths: 15,
        ratingPaceWindow: 'since_set',
      }).body,
    ).toBe('1.5 new reviews a week since the goal was set; the goal’s pace is 2 a week.')
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingPacePerWeek: 2,
        ratingRecentPaceTenths: 10,
        ratingPaceWindow: 'last_4_weeks',
      }).body,
    ).toBe('1 new review a week over the last 4 weeks; the goal’s pace is 2 a week.')
  })

  it('says plainly when no review came in', () => {
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingRecentPaceTenths: 0,
        ratingPaceWindow: 'last_4_weeks',
      }).body,
    ).toBe('No new reviews over the last 4 weeks; the goal’s pace is 11 a week.')
  })
})

describe('entered Below pace, for a plan in tenths a week (rounds 3 and 4)', () => {
  const below = { ...AT, ratingTargetTenths: 45, ratingPacePerWeek: 14 } as const

  it('reads a day for a plan of one a day or more', () => {
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingPaceTenthsPerWeek: 140,
        ratingRecentPaceTenths: 63,
        ratingPaceWindow: 'last_4_weeks',
      }).body,
    ).toBe('0.9 new reviews a day over the last 4 weeks; the plan is 2 a day.')
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingPaceTenthsPerWeek: 105,
        ratingRecentPaceTenths: 70,
        ratingPaceWindow: 'since_set',
      }).body,
    ).toBe('1 new review a day since the goal was set; the plan is 1.5 a day.')
  })

  it('says plainly when no review came in', () => {
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingPaceTenthsPerWeek: 140,
        ratingRecentPaceTenths: 0,
        ratingPaceWindow: 'last_4_weeks',
      }).body,
    ).toBe('No new reviews over the last 4 weeks; the plan is 2 a day.')
  })

  it.each([
    [2, '0.2 new reviews a week over the last 4 weeks; the plan is 1 a day.'],
    [3, '0.3 new reviews a week over the last 4 weeks; the plan is 1 a day.'],
  ])('reads a week when %i tenths a week round to 0 a day', (recentTenths, body) => {
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingPaceTenthsPerWeek: 70,
        ratingRecentPaceTenths: recentTenths,
        ratingPaceWindow: 'last_4_weeks',
      }).body,
    ).toBe(body)
  })

  it('reads a week for a plan under one a day', () => {
    expect(
      copy('goal.rating_below_pace', {
        ...below,
        ratingPacePerWeek: 3,
        ratingPaceTenthsPerWeek: 30,
        ratingRecentPaceTenths: 15,
        ratingPaceWindow: 'last_4_weeks',
      }).body,
    ).toBe('1.5 new reviews a week over the last 4 weeks; the plan is 3 a week.')
  })
})

describe('entered New reviews too low', () => {
  it('says new reviews since the goal was set average below what the target needs, with no number of stars', () => {
    const rendered = copy('goal.rating_too_low', { ...AT, ratingTargetTenths: 40 })

    expect(rendered).toEqual({
      title: 'New Google reviews for Riverside Hotel are too low for 4.0',
      body: 'Since you set the goal they average below what 4.0 needs. Open the goal to see what helps.',
      detail:
        'Since you set the goal they average below what 4.0 needs. Open the goal to see what helps.',
      actionLabel: 'View goal',
      summary: 'Riverside Hotel · new reviews too low',
    })
    // The only number in the copy is the goal's own target.
    expect(`${rendered.title} ${rendered.body}`.match(/\d+(\.\d+)?/gu)).toEqual([
      '4.0',
      '4.0',
    ])
  })

  it('reads without the Property or the target', () => {
    expect(copy('goal.rating_too_low', {})).toMatchObject({
      title: 'New Google reviews are too low for the goal',
      body: 'Since you set the goal they average below what it needs. Open the goal to see what helps.',
      summary: 'new reviews too low',
    })
    expect(copy('goal.rating_too_low', { ratingTargetTenths: 45 }).title).toBe(
      'New Google reviews are too low for 4.5',
    )
  })
})

describe('a keep goal dropped below', () => {
  it('says what Google shows against the tenth being kept', () => {
    expect(
      copy('goal.rating_keep_dropped', {
        ...AT,
        ratingShownTenths: 44,
        ratingTargetTenths: 45,
        ratingGoalMode: 'keep',
      }),
    ).toEqual({
      title: 'Google now shows 4.4 for Riverside Hotel, below the 4.5 you’re keeping',
      body: 'Open the goal to see what it takes to get back.',
      detail: '',
      actionLabel: 'View goal',
      summary: 'Riverside Hotel · below the rating you keep',
    })
  })
})

describe('where a rating goal notice opens', () => {
  it.each([
    'goal.rating_reached',
    'goal.rating_changed',
    'goal.rating_below_pace',
    'goal.rating_too_low',
    'goal.rating_keep_dropped',
  ] as const)('%s opens the Property’s Goals page, not a monthly result', (type) => {
    expect(notificationLink('goal', 'goal-id', 'property-1', type)).toEqual({
      path: '/properties/property-1/goals',
      search: {},
    })
  })
})
