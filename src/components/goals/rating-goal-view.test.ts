// What the Google rating goal says, worked out once for the card, the detail
// page and the history: Google's own number first, plain words, "review" for a
// Google review only, and a forecast that is a month range, never a date.
import { describe, expect, it } from 'vitest'
import {
  averageProgressText,
  cardOutlook,
  cardPaceLine,
  changeText,
  exactProgressText,
  forecastMonths,
  forecastSentence,
  googleShows,
  historyEntryView,
  OUTCOME_SHOWN_FOR_DAYS,
  outcomeFromCard,
  RATING_GOAL_STATUS,
  ratingText,
  recentOutcome,
  reviewsText,
  waitingSentence,
} from './rating-goal-view'
import {
  CARD,
  CARD_JUST_SET,
  CARD_KEEP,
  CARD_REACHED,
  FIXTURE_NOW,
  FIXTURE_TIMEZONE,
  HISTORY,
} from './rating-goal.stories.fixtures'

const NOW = new Date(FIXTURE_NOW)

describe('the numbers', () => {
  it('prints a rating as Google does, to one decimal', () => {
    expect(ratingText(4.5)).toBe('4.5')
    expect(ratingText(5)).toBe('5.0')
  })

  it('counts reviews in words, one or many', () => {
    expect(reviewsText(1)).toBe('1 review')
    expect(reviewsText(1300)).toBe('1,300 reviews')
  })

  it('reads the exact average against the threshold, never rounding it up past the line', () => {
    expect(exactProgressText(4.382, 4.45)).toBe('4.38 of 4.45')
    expect(exactProgressText(4.449, 4.45)).toBe('4.44 of 4.45')
    expect(exactProgressText(null, 4.45)).toBe('Exact average not known yet')
  })

  it('names the average exact from the complete cache, about that from Google’s own figure', () => {
    expect(averageProgressText(CARD)).toBe('Exact average 4.38 of 4.45')
    expect(
      averageProgressText({ ...CARD, exactAverage: 4.3, exactAverageSource: 'google' }),
    ).toBe('About 4.30 of 4.45')
    expect(
      averageProgressText({ ...CARD, exactAverage: null, exactAverageSource: null }),
    ).toBe('Exact average not known yet')
  })
})

describe('what Google shows', () => {
  it('is its own number while the numbers are current', () => {
    expect(googleShows(CARD.google, FIXTURE_TIMEZONE, NOW)).toEqual({
      figure: '4.3',
      asOf: null,
    })
  })

  it('keeps the last number with its date when the numbers are stale', () => {
    const stale = { ...CARD.google!, current: false, asOf: '2026-10-12T08:00:00.000Z' }

    expect(googleShows(stale, FIXTURE_TIMEZONE, NOW)).toEqual({
      figure: '4.3',
      asOf: 'as of Oct 12',
    })
  })

  it('is a dash only when no number was ever read', () => {
    expect(googleShows(null, FIXTURE_TIMEZONE, NOW)).toEqual({ figure: '–', asOf: null })
  })
})

describe('the forecast', () => {
  it('names the months of a range, the year once when they share it', () => {
    expect(
      forecastMonths({ kind: 'range', fromMonth: '2027-07', toMonth: '2027-09' }),
    ).toBe('Jul–Sep 2027')
    expect(
      forecastMonths({ kind: 'range', fromMonth: '2026-11', toMonth: '2027-01' }),
    ).toBe('Nov 2026 – Jan 2027')
    expect(
      forecastMonths({ kind: 'range', fromMonth: '2027-07', toMonth: '2027-07' }),
    ).toBe('Jul 2027')
    expect(forecastMonths({ kind: 'range', fromMonth: '2028-12', toMonth: null })).toBe(
      'Dec 2028 or later',
    )
  })

  it('says why there is no range instead of drawing one', () => {
    expect(forecastSentence({ kind: 'unreachable' }, 4.8)).toBe(
      'No pace reaches 4.8 at the recent star mix',
    )
    expect(forecastSentence({ kind: 'no_pace' }, 4.5)).toBe(
      'No new reviews in the last 4 weeks to forecast from',
    )
    expect(forecastSentence({ kind: 'beyond_horizon' }, 4.7)).toBe(
      'More than ten years away at this pace',
    )
    expect(forecastSentence(CARD.forecast!, 4.5)).toBe('Expected around Jul–Sep 2027')
  })
})

describe('the simple card', () => {
  it('asks for a pace while the goal is new, then counts the week against it', () => {
    expect(cardPaceLine(CARD_JUST_SET)).toBe('Aim for about 11 new reviews a week')
    expect(cardPaceLine(CARD)).toBe('This week: 6 of 11 reviews')
    expect(cardPaceLine({ ...CARD, pacePerWeek: 1, thisWeekCount: 0 })).toBe(
      'This week: 0 of 1 review',
    )
  })

  it('has no pace line for a goal that keeps a number', () => {
    expect(cardPaceLine(CARD_KEEP)).toBeNull()
    expect(cardOutlook(CARD_KEEP, FIXTURE_TIMEZONE, NOW)).toBeNull()
  })

  it('forecasts, or says why it cannot, one line', () => {
    expect(cardOutlook(CARD, FIXTURE_TIMEZONE, NOW)).toBe('Expected around Jul–Sep 2027')
    expect(cardOutlook({ ...CARD, googleShowsSoon: true }, FIXTURE_TIMEZONE, NOW)).toBe(
      'Google should show 4.5 soon',
    )
    expect(
      cardOutlook(
        { ...CARD, status: 'cant_reach_at_mix', forecast: { kind: 'unreachable' } },
        FIXTURE_TIMEZONE,
        NOW,
      ),
    ).toBe(
      'No pace reaches 4.5 at the recent star mix. A lower goal can still be reached.',
    )
  })

  it('waits for Google without repeating the day the headline already gives', () => {
    const waiting = {
      ...CARD,
      status: 'waiting_for_google' as const,
      google: { ...CARD.google!, current: false, asOf: '2026-10-12T08:00:00.000Z' },
    }

    expect(cardOutlook(waiting, FIXTURE_TIMEZONE, NOW)).toBe(
      'Waiting for Google’s latest numbers.',
    )
    expect(cardOutlook({ ...waiting, google: null }, FIXTURE_TIMEZONE, NOW)).toBe(
      'Waiting for Google’s numbers.',
    )
  })

  it('names the day of numbers the headline does not date, and never a clock time', () => {
    const google = { ...CARD.google!, current: true, asOf: '2026-10-12T08:00:00.000Z' }

    expect(waitingSentence(google, FIXTURE_TIMEZONE, NOW)).toBe(
      'Waiting for Google’s latest numbers. These are from Oct 12.',
    )
  })

  it('labels every status, with the tone of its verdict', () => {
    expect(RATING_GOAL_STATUS.on_pace).toEqual({ label: 'On pace', tone: 'positive' })
    expect(RATING_GOAL_STATUS.below_pace).toEqual({ label: 'Below pace', tone: 'warn' })
    expect(RATING_GOAL_STATUS.cant_reach_at_mix).toEqual({
      label: 'Can’t reach at this mix',
      tone: 'warn',
    })
    expect(RATING_GOAL_STATUS.getting_started.tone).toBe('neutral')
    expect(RATING_GOAL_STATUS.waiting_for_google.tone).toBe('neutral')
    expect(RATING_GOAL_STATUS.holding.label).toBe('Holding')
    expect(RATING_GOAL_STATUS.dropped_below).toEqual({
      label: 'Dropped below',
      tone: 'warn',
    })
  })
})

describe('the history', () => {
  it('says a reached goal’s target, pace and both dates', () => {
    expect(historyEntryView(HISTORY[0]!, FIXTURE_TIMEZONE, NOW)).toEqual({
      title: 'Reach 4.3 on Google',
      summary: '9 a week · set Mar 2 · reached Jul 28',
      status: { label: 'Reached', tone: 'positive' },
    })
  })

  it('says an ended goal’s reason in plain words', () => {
    expect(historyEntryView(HISTORY[1]!, FIXTURE_TIMEZONE, NOW)).toEqual({
      title: 'Keep 4.2 on Google',
      summary: 'set Nov 10, 2025 · ended Feb 20 · Google location changed',
      status: { label: 'Ended', tone: 'neutral' },
    })
  })
})

describe('a goal reached or ended lately', () => {
  const DAY = 24 * 60 * 60 * 1000
  const reached = { ...HISTORY[0]!, reachedAt: '2026-10-12T05:10:00.000Z' }

  it('is the goal the card read found reached, on the day of that read', () => {
    expect(outcomeFromCard(CARD_REACHED, NOW)).toEqual({
      goalId: CARD_REACHED.goalId,
      state: 'reached',
      targetTenths: 45,
      target: 4.5,
      endedReason: null,
      at: FIXTURE_NOW,
    })
    expect(outcomeFromCard(CARD, NOW)).toBeNull()
  })

  it('is the newest goal in History, on the day it was really reached', () => {
    expect(recentOutcome([reached, HISTORY[1]!], NOW)).toEqual({
      goalId: reached.goalId,
      state: 'reached',
      targetTenths: 43,
      target: 4.3,
      endedReason: null,
      at: '2026-10-12T05:10:00.000Z',
    })
  })

  it('tells a goal ended by a Google location change, but not one a manager ended', () => {
    const ended = { ...HISTORY[1]!, endedAt: '2026-10-13T14:00:00.000Z' }

    expect(recentOutcome([ended], NOW)).toMatchObject({
      state: 'ended',
      endedReason: 'google_location_changed',
      at: '2026-10-13T14:00:00.000Z',
    })
    expect(recentOutcome([{ ...ended, endedReason: 'manager' }, reached], NOW)).toBeNull()
  })

  it('is no news once it is more than two weeks old, or when History is empty', () => {
    const old = new Date(NOW.getTime() - (OUTCOME_SHOWN_FOR_DAYS + 1) * DAY)

    expect(recentOutcome([{ ...reached, reachedAt: old.toISOString() }], NOW)).toBeNull()
    expect(recentOutcome([], NOW)).toBeNull()
    expect(recentOutcome(undefined, NOW)).toBeNull()
  })
})

describe('the change log', () => {
  it('reads each change old to new, in the words the page uses', () => {
    const at = '2026-09-02T08:15:00.000Z'
    const change = { changedBy: 'user-1', changedAt: at }

    expect(
      changeText({ ...change, field: 'target', oldValue: '44', newValue: '45' }),
    ).toBe('Target 4.4 → 4.5')
    expect(changeText({ ...change, field: 'pace', oldValue: '14', newValue: '11' })).toBe(
      'Pace 14 → 11 a week',
    )
    expect(changeText({ ...change, field: 'pace', oldValue: '11', newValue: null })).toBe(
      'Pace 11 a week → none',
    )
    expect(
      changeText({ ...change, field: 'mode', oldValue: 'climb', newValue: 'keep' }),
    ).toBe('Goal reach → keep')
  })
})
