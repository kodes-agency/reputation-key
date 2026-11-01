// "What can you do this week?" and, for a goal to keep a number, "Is it holding?" on the
// Google rating goal's page, in words (2026-11-01, ADR 0067). "Is your rating going up?"
// is `rating-goal-bands-view.test.ts`.
import { describe, expect, it } from 'vitest'
import { keepBand, todoBand, type BandContext } from './rating-goal-bands-view'
import { PLAN_POLICY_LINE } from './rating-goal-copy'
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
import { FIXTURE_NOW, FIXTURE_TIMEZONE } from './rating-goal.stories.fixtures'

type Detail = Parameters<typeof todoBand>[0]

const context: BandContext = { timezone: FIXTURE_TIMEZONE, now: new Date(FIXTURE_NOW) }

/** The detail with the number Google shows changed; null is a Google that shows none. */
const showing = (detail: Detail, shows: number | null): Detail => ({
  ...detail,
  google: detail.google === null ? null : { ...detail.google, shows },
})

describe('what can you do this week?', () => {
  const todo = (detail: Detail) => todoBand(detail)

  it.each([
    ['on pace', DETAIL_HARBORLINE, 'Keep asking every guest'],
    ['below its pace', DETAIL_BELOW_PACE, 'Ask more guests'],
    ['just set', DETAIL_JUST_SET, 'Start asking every guest'],
    [
      'getting started',
      { ...DETAIL_JUST_SET, justSet: false },
      'Start asking every guest',
    ],
    [
      'waiting for Google',
      { ...DETAIL_HARBORLINE, status: 'waiting_for_google' as const },
      'Keep asking every guest',
    ],
  ])('answers for a goal %s: %s', (_, detail, answer) => {
    expect(todo(detail)).toMatchObject({
      title: 'What can you do this week?',
      icon: 'flag',
      answer,
      tone: 'neutral',
    })
  })

  it('says what guests complain about, with the approved words, when new reviews are too low', () => {
    expect(todo(DETAIL_TOO_LOW)).toEqual({
      title: 'What can you do this week?',
      icon: 'flag',
      answer: 'Fix what guests complain about',
      hint: PLAN_POLICY_LINE,
      tone: 'neutral',
    })
  })

  it('puts new reviews that are too low before a goal that is also just set', () => {
    expect(todo({ ...DETAIL_JUST_SET, status: 'reviews_too_low' }).answer).toBe(
      'Fix what guests complain about',
    )
  })

  it('says this week’s reviews so far and the day, under every answer but the one for low stars', () => {
    expect(todo(DETAIL_HARBORLINE).hint).toBe(
      '2 new reviews so far this week. It’s Tuesday.',
    )
    expect(todo(DETAIL_BELOW_PACE).hint).toBe(
      '2 new reviews so far this week. It’s Tuesday.',
    )
    expect(todo(DETAIL_JUST_SET).hint).toBe('No new reviews yet this week. It’s Tuesday.')
  })

  it('says one new review in the singular', () => {
    expect(todo({ ...DETAIL_HARBORLINE, thisWeekCount: 1 }).hint).toBe(
      '1 new review so far this week. It’s Tuesday.',
    )
  })

  it.each([
    [1, 'Monday'],
    [3, 'Wednesday'],
    [7, 'Sunday'],
  ])('names day %i of the Property’s week %s', (weekday, name) => {
    expect(todo({ ...DETAIL_HARBORLINE, weekday }).hint).toContain(`It’s ${name}.`)
  })

  it('asks for the next goal once this one is over', () => {
    const next = {
      title: 'What’s next?',
      icon: 'flag',
      answer: 'Set your next goal',
      hint: 'This goal is in History now.',
      tone: 'neutral',
    }

    expect(todo(DETAIL_FOUND_REACHED)).toEqual(next)
    expect(todo(DETAIL_FOUND_ENDED)).toEqual(next)
  })
})

describe('is it holding?', () => {
  it('says yes, with Google’s number and nothing more, for a goal to keep a number', () => {
    expect(keepBand(DETAIL_KEEP, context)).toEqual({
      title: 'Is it holding?',
      icon: 'up',
      answer: 'Yes. Google shows 4.8',
      hint: null,
      tone: 'positive',
    })
  })

  it('says not right now, with what moves the number, once Google shows less', () => {
    const dropped = {
      ...showing(DETAIL_KEEP, 4.7),
      status: 'dropped_below' as const,
    }

    expect(keepBand(dropped, context)).toEqual({
      title: 'Is it holding?',
      icon: 'down',
      answer: 'Not right now. Google shows 4.7',
      hint: 'You’re keeping 4.8. Asking every guest, not only the ones who would write anyway, and better stays are what move this number.',
      tone: 'warn',
    })
  })

  it('waits for Google’s latest numbers while they are stale', () => {
    const stale = {
      ...DETAIL_KEEP,
      status: 'waiting_for_google' as const,
      google: { ...DETAIL_KEEP.google!, current: false },
    }

    expect(keepBand(stale, context)).toEqual({
      title: 'Is it holding?',
      icon: 'wait',
      answer: 'Waiting for Google’s latest numbers',
      hint: 'Waiting for Google’s latest numbers.',
      tone: 'neutral',
    })
  })

  it('waits when Google has no number to hold against', () => {
    expect(keepBand(showing(DETAIL_KEEP, null), context).icon).toBe('wait')
    expect(keepBand({ ...DETAIL_KEEP, google: null }, context).hint).toBe(
      'Waiting for Google’s numbers.',
    )
  })
})
