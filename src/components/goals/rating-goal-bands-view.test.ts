// "Is your rating going up?" on the Google rating goal's page, in words (2026-11-01,
// ADR 0067): answered first, once, from what the read decided. Nothing here is a date
// to come: arrivals stay durations. "What can you do this week?" and "Is it holding?"
// are `rating-goal-bands-view-todo.test.ts`; whether enough good reviews are coming in
// is `rating-goal-review-facts-view.test.ts`.
import { describe, expect, it } from 'vitest'
import { dateOf, risingBand, type BandContext } from './rating-goal-bands-view'
import {
  DETAIL_GOOGLE_SOURCE,
  DETAIL_HARBORLINE,
  DETAIL_LAGS,
  DETAIL_TOO_LOW,
} from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_BELOW_PACE,
  DETAIL_JUST_SET,
} from './rating-goal-detail-states.stories.fixtures'
import {
  DETAIL_FOUND_ENDED,
  DETAIL_FOUND_REACHED,
  DETAIL_WENT_BACK,
} from './rating-goal-detail-outcomes.stories.fixtures'
import { FIXTURE_NOW, FIXTURE_TIMEZONE } from './rating-goal.stories.fixtures'

type Detail = Parameters<typeof risingBand>[0]

const context: BandContext = { timezone: FIXTURE_TIMEZONE, now: new Date(FIXTURE_NOW) }

/** The detail with the number Google shows changed; null is a Google that shows none. */
const showing = (detail: Detail, shows: number | null): Detail => ({
  ...detail,
  google: detail.google === null ? null : { ...detail.google, shows },
})

/** The detail with Google's moves since the set, newest first. */
const moved = (
  detail: Detail,
  shownChanges: Detail['moved']['shownChanges'],
): Detail => ({
  ...detail,
  moved: { ...detail.moved, shownChanges },
})

describe('a date in the page’s words', () => {
  it('prints a day of this year as a month and a day', () => {
    expect(dateOf('2026-10-08T07:00:00.000Z', context)).toBe('Oct 8')
  })

  it('prints a day of another year with its year', () => {
    expect(dateOf('2025-12-30T10:00:00.000Z', context)).toBe('Dec 30, 2025')
  })

  it('prints the day on the Property’s calendar, not UTC’s', () => {
    // 22:30 UTC on 7 Oct is 01:30 on 8 Oct in Sofia.
    expect(dateOf('2026-10-07T22:30:00.000Z', context)).toBe('Oct 8')
  })
})

describe('is your rating going up?', () => {
  it('says yes, from where it started to where Google shows it, and when it began to', () => {
    expect(risingBand(DETAIL_HARBORLINE, context)).toEqual({
      title: 'Is your rating going up?',
      icon: 'up',
      answer: 'Yes, from 3.9 to 4.0',
      hint: 'Google started showing 4.0 on Oct 8.',
      tone: 'positive',
    })
  })

  it('says yes with nothing to add when no move of Google’s number was recorded', () => {
    expect(risingBand(moved(DETAIL_HARBORLINE, []), context).hint).toBeNull()
  })

  it('names the year of a move that was in another year', () => {
    const old = moved(DETAIL_HARBORLINE, [
      { at: '2025-12-30T10:00:00.000Z', tenths: 40, up: true },
    ])

    expect(risingBand(old, context).hint).toBe(
      'Google started showing 4.0 on Dec 30, 2025.',
    )
  })

  it('goes by the newest move: a move back, then up again, is a yes', () => {
    const again = moved(DETAIL_HARBORLINE, [
      { at: '2026-10-12T07:00:00.000Z', tenths: 40, up: true },
      { at: '2026-10-05T07:00:00.000Z', tenths: 39, up: false },
    ])

    expect(risingBand(again, context)).toMatchObject({
      answer: 'Yes, from 3.9 to 4.0',
      hint: 'Google started showing 4.0 on Oct 12.',
      tone: 'positive',
    })
  })

  it('says yes, and that Google should show the goal soon, once the reviews clear it', () => {
    expect(risingBand(DETAIL_LAGS, context)).toEqual({
      title: 'Is your rating going up?',
      icon: 'up',
      answer: 'Yes. Google should show 4.1 soon',
      hint: 'Your reviews already clear 4.1. Google’s number can take up to two weeks to catch up.',
      tone: 'positive',
    })
  })

  it('says it is not on course when new reviews are too low, though Google went up', () => {
    expect(risingBand(DETAIL_TOO_LOW, context)).toEqual({
      title: 'Is your rating going up?',
      icon: 'down',
      answer: 'Up to 4.0, but not on course for 4.1',
      hint: 'Since you set the goal, new reviews average below what 4.1 needs.',
      tone: 'warn',
    })
  })

  it('says it is holding when new reviews are too low and Google has not gone up', () => {
    const holding = showing(moved(DETAIL_TOO_LOW, []), 3.9)

    expect(risingBand(holding, context)).toMatchObject({
      answer: 'Not yet. It’s holding at 3.9',
      tone: 'warn',
    })
  })

  it('says Google went back, when, and how many new reviews it takes to the next number', () => {
    expect(risingBand(DETAIL_WENT_BACK, context)).toEqual({
      title: 'Is your rating going up?',
      icon: 'down',
      answer: 'Not lately. Google went back to 3.9',
      hint: 'It went back on Oct 5. 1 new review to 4.0.',
      tone: 'warn',
    })
  })

  it('says only when Google went back when there is no number to count to', () => {
    expect(risingBand({ ...DETAIL_WENT_BACK, next: null }, context).hint).toBe(
      'It went back on Oct 5.',
    )
  })

  it('says “about” before a count while RepKey lacks some of Google’s reviews', () => {
    const approximate = moved(DETAIL_GOOGLE_SOURCE, DETAIL_WENT_BACK.moved.shownChanges)

    expect(risingBand(approximate, context).hint).toBe(
      'It went back on Oct 5. About 18 new reviews to 4.1.',
    )
  })

  it('says it has just started while Google shows what it showed, in the first days', () => {
    expect(risingBand(DETAIL_JUST_SET, context)).toEqual({
      title: 'Is your rating going up?',
      icon: 'new',
      answer: 'You’ve just started',
      hint: 'Google shows 3.9. New reviews take a few weeks to show there.',
      tone: 'neutral',
    })
  })

  it('says it has just started while the goal is getting started, though not set yesterday', () => {
    const started = { ...DETAIL_JUST_SET, justSet: false }

    expect(risingBand(started, context).answer).toBe('You’ve just started')
  })

  it('says Google went down when it shows less than it did at the set', () => {
    const lower = showing(moved(DETAIL_HARBORLINE, []), 3.8)

    expect(risingBand(lower, context)).toEqual({
      title: 'Is your rating going up?',
      icon: 'down',
      answer: 'No. Google went down to 3.8',
      hint: 'It showed 3.9 when you started. 18 new reviews to 4.1.',
      tone: 'warn',
    })
  })

  it('says it is not on Google yet when Google still shows the number of the set', () => {
    const same = showing(moved(DETAIL_HARBORLINE, []), 3.9)

    expect(risingBand(same, context)).toEqual({
      title: 'Is your rating going up?',
      icon: 'up',
      answer: 'Not on Google yet',
      hint: 'Google still shows 3.9. 18 new reviews to 4.1.',
      tone: 'neutral',
    })
  })

  it('warns of it when the goal is behind its pace', () => {
    const behind = showing(moved(DETAIL_BELOW_PACE, []), 3.9)

    expect(risingBand(behind, context)).toMatchObject({
      answer: 'Not on Google yet',
      tone: 'warn',
    })
  })

  it('leaves the count out when there is no number to count to', () => {
    const same = { ...showing(moved(DETAIL_HARBORLINE, []), 3.9), next: null }

    expect(risingBand(same, context).hint).toBe('Google still shows 3.9.')
  })
})

describe('is your rating going up, while Google is quiet', () => {
  const waits = (detail: Detail) => risingBand(detail, context)

  it('waits for Google’s latest numbers while its numbers are stale', () => {
    const stale = {
      ...DETAIL_HARBORLINE,
      status: 'waiting_for_google' as const,
      google: { ...DETAIL_HARBORLINE.google!, current: false },
    }

    expect(waits(stale)).toEqual({
      title: 'Is your rating going up?',
      icon: 'wait',
      answer: 'Waiting for Google’s latest numbers',
      hint: 'Waiting for Google’s latest numbers.',
      tone: 'neutral',
    })
  })

  it('names the day of numbers that are current but still wait for something', () => {
    const waiting = { ...DETAIL_HARBORLINE, status: 'waiting_for_google' as const }

    expect(waits(waiting).hint).toBe(
      'Waiting for Google’s latest numbers. These are from Oct 14.',
    )
  })

  it('waits when Google has sent no number yet', () => {
    expect(waits({ ...DETAIL_HARBORLINE, google: null })).toMatchObject({
      icon: 'wait',
      hint: 'Waiting for Google’s numbers.',
    })
  })

  it('waits when Google has sent no average to show', () => {
    expect(waits(showing(DETAIL_HARBORLINE, null)).icon).toBe('wait')
  })
})

describe('is your rating going up, once the goal is over', () => {
  it('asks whether you got there, and says how long it took, for a goal reached', () => {
    expect(risingBand(DETAIL_FOUND_REACHED, context)).toEqual({
      title: 'Did you get there?',
      icon: 'done',
      answer: 'Yes. Google shows 4.1',
      hint: 'From 3.9 in 3 weeks.',
      tone: 'positive',
    })
  })

  it.each([
    [-1, 'in 1 day'],
    [-5, 'in 5 days'],
    [-13, 'in 13 days'],
    [-14, 'in 2 weeks'],
    [-20, 'in 3 weeks'],
    [-200, 'in 29 weeks'],
  ])('says a goal set on day %i took %s', (setDay, taken) => {
    const reached = {
      ...DETAIL_FOUND_REACHED,
      chart: { ...DETAIL_FOUND_REACHED.chart!, setDay },
    }

    expect(risingBand(reached, context).hint).toBe(`From 3.9 ${taken}.`)
  })

  it('says how it started alone when the chart is not there to say how long', () => {
    const reached = { ...DETAIL_FOUND_REACHED, chart: null }

    expect(risingBand(reached, context).hint).toBe('From 3.9.')
  })

  it('asks where it got to, and says where it started, for a goal that ended', () => {
    expect(risingBand(DETAIL_FOUND_ENDED, context)).toEqual({
      title: 'Where did it get to?',
      icon: 'flag',
      answer: 'Google shows 4.0',
      hint: 'Google showed 3.9 when you started.',
      tone: 'neutral',
    })
  })

  it('says only that the goal has ended when Google shows no number', () => {
    expect(risingBand(showing(DETAIL_FOUND_ENDED, null), context).answer).toBe(
      'This goal has ended',
    )
  })
})
