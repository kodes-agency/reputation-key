// What the Google rating goal says, worked out once for the card, the detail
// page and the history: Google's own number first, plain words, "review" for a
// Google review only, and a forecast that is a month range, never a date.
import { describe, expect, it } from 'vitest'
import {
  averageProgressText,
  cardPaceLine,
  changeText,
  exactProgressText,
  googleShows,
  historyEntryView,
  OUTCOME_SHOWN_FOR_DAYS,
  outcomeFromCard,
  RATING_GOAL_STATUS,
  ratingGoalStatusBadge,
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

describe('the simple card', () => {
  it('asks for a pace while the goal is new, then counts the week against it', () => {
    expect(cardPaceLine(CARD_JUST_SET)).toBe('Aim for about 1.6 new reviews a day')
    expect(cardPaceLine({ ...CARD_JUST_SET, paceTenthsPerWeek: 30 })).toBe(
      'Aim for about 3 new reviews a week',
    )
    expect(cardPaceLine(CARD)).toBe('This week: 6 of 11 reviews')
    expect(cardPaceLine({ ...CARD, paceTenthsPerWeek: 10, thisWeekCount: 0 })).toBe(
      'This week: 0 of 1 review',
    )
  })

  it('has no pace line for a goal that keeps a number', () => {
    expect(cardPaceLine(CARD_KEEP)).toBeNull()
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
    expect(RATING_GOAL_STATUS.reviews_too_low).toEqual({
      label: 'New reviews too low',
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

  it('names the target where new reviews are too low for it, and only there', () => {
    expect(ratingGoalStatusBadge({ status: 'reviews_too_low', target: 4 })).toEqual({
      label: 'New reviews too low for 4.0',
      tone: 'warn',
    })
    expect(ratingGoalStatusBadge(CARD)).toEqual({ label: 'On pace', tone: 'positive' })
  })

  it('reads a status from a server newer than the page as Unknown', () => {
    expect(
      ratingGoalStatusBadge({ ...CARD, status: 'brand_new' as typeof CARD.status }),
    ).toEqual({ label: 'Unknown', tone: 'neutral' })
  })
})

describe('the history', () => {
  it('says a reached goal’s target, pace and both dates', () => {
    expect(historyEntryView(HISTORY[0]!, FIXTURE_TIMEZONE, NOW)).toEqual({
      title: 'Reach 4.3 on Google',
      summary: '1.3 a day · set Mar 2 · reached Jul 28',
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
  const change = { changedBy: 'user-1', changedAt: '2026-09-02T08:15:00.000Z' }

  it('reads each change old to new, in the words the page uses', () => {
    expect(
      changeText({ ...change, field: 'target', oldValue: '44', newValue: '45' }),
    ).toBe('Target 4.4 → 4.5')
    // The log keeps tenths of a review a week: never "0.2 → 0.3".
    expect(
      changeText({ ...change, field: 'pace', oldValue: '140', newValue: '105' }),
    ).toBe('Pace 2 → 1.5 a day')
    expect(
      changeText({ ...change, field: 'pace', oldValue: '110', newValue: null }),
    ).toBe('Pace 1.6 a day → none')
    expect(
      changeText({ ...change, field: 'mode', oldValue: 'climb', newValue: 'keep' }),
    ).toBe('Goal reach → keep')
  })

  it('words a planned quality as the new reviews’ average, in stars', () => {
    const quality = { ...change, field: 'quality' } as const

    expect(changeText({ ...quality, oldValue: '45', newValue: '47' })).toBe(
      'New reviews average 4.5★ → 4.7★',
    )
    // A goal set before round 2 had none; a goal switched to keep has none.
    expect(changeText({ ...quality, oldValue: null, newValue: '45' })).toBe(
      'New reviews average set to 4.5★',
    )
    expect(changeText({ ...quality, oldValue: '45', newValue: null })).toBe(
      'New reviews average 4.5★ → none',
    )
  })
})
