import { describe, expect, it } from 'vitest'
import type { RatingGoalEvaluationMark, RatingGoalStatus } from './rating-goal'
import {
  BELOW_PACE_NOTICE_DAYS,
  TOO_LOW_NOTICE_DAYS,
  decideRatingGoalNotices,
  type RatingGoalNoticeInput,
} from './rating-goal-notices'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-14T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)

const mark = (
  overrides: Partial<RatingGoalEvaluationMark> = {},
): RatingGoalEvaluationMark => ({
  displayedTenths: 43,
  status: 'on_pace',
  evaluatedAt: daysAgo(1),
  knownStatus: 'on_pace',
  belowPaceNoticedAt: null,
  tooLowNoticedAt: null,
  ...overrides,
})

type Overrides = Readonly<{
  mode?: 'climb' | 'keep'
  targetTenths?: number
  previous?: Partial<RatingGoalEvaluationMark>
  status?: RatingGoalStatus
  displayedTenths?: number | null
  outcome?: 'continues' | 'reached' | 'ended'
  pace?: RatingGoalNoticeInput['pace']
}>

/** A climb goal for 4.5 at 11 a week, 40 days old, Google showing 4.3. */
const decide = (overrides: Overrides = {}) =>
  decideRatingGoalNotices({
    goal: {
      mode: overrides.mode ?? 'climb',
      targetTenths: overrides.targetTenths ?? 45,
      pacePerWeek: overrides.mode === 'keep' ? null : 11,
      lastEvaluation: mark(overrides.previous),
    },
    evaluation: {
      status: overrides.status ?? 'on_pace',
      displayedTenths:
        overrides.displayedTenths === undefined ? 43 : overrides.displayedTenths,
      outcome: overrides.outcome ?? 'continues',
    },
    pace:
      overrides.pace === undefined
        ? { reviews: 24, window: { start: daysAgo(28), end: NOW } }
        : overrides.pace,
    now: NOW,
  })

const transitions = (overrides: Overrides = {}) =>
  decide(overrides).notices.map((notice) => notice.transition)

describe('a repeat of what the goal already holds', () => {
  it('tells nobody anything', () => {
    expect(decide()).toEqual({
      notices: [],
      knownStatus: 'on_pace',
      belowPaceNoticedAt: null,
      tooLowNoticedAt: null,
    })
  })
})

describe('reached', () => {
  it('is told once, with the tenth Google shows and the target', () => {
    expect(
      decide({ status: 'reached', displayedTenths: 45, outcome: 'reached' }).notices,
    ).toEqual([{ transition: 'reached', targetTenths: 45, shownTenths: 45 }])
  })

  it('is the only notice when the same change is a tenth gained', () => {
    expect(
      transitions({
        previous: { displayedTenths: 44 },
        status: 'reached',
        displayedTenths: 46,
        outcome: 'reached',
      }),
    ).toEqual(['reached'])
  })
})

describe('a tenth gained or lost on Google', () => {
  it('says what Google shows now and what it showed before', () => {
    expect(decide({ displayedTenths: 44 }).notices).toEqual([
      {
        transition: 'google_rating_changed',
        mode: 'climb',
        targetTenths: 45,
        shownTenths: 44,
        previousTenths: 43,
      },
    ])
    expect(decide({ displayedTenths: 42 }).notices).toEqual([
      {
        transition: 'google_rating_changed',
        mode: 'climb',
        targetTenths: 45,
        shownTenths: 42,
        previousTenths: 43,
      },
    ])
  })

  it('stays quiet while Google cannot be read, and compares with the last tenth it showed', () => {
    expect(transitions({ status: 'waiting_for_google', displayedTenths: null })).toEqual(
      [],
    )
    expect(
      transitions({
        previous: { status: 'waiting_for_google', displayedTenths: 43 },
        displayedTenths: 43,
      }),
    ).toEqual([])
  })

  it('has no "from" before the goal ever saw a tenth', () => {
    expect(
      transitions({ previous: { displayedTenths: null }, displayedTenths: 44 }),
    ).toEqual([])
  })

  it('is told for a keep goal that gains a tenth above the one it keeps', () => {
    expect(
      decide({
        mode: 'keep',
        targetTenths: 45,
        previous: { displayedTenths: 45, status: 'holding', knownStatus: 'holding' },
        status: 'holding',
        displayedTenths: 46,
      }).notices,
    ).toEqual([
      {
        transition: 'google_rating_changed',
        mode: 'keep',
        targetTenths: 45,
        shownTenths: 46,
        previousTenths: 45,
      },
    ])
  })
})

describe('a keep goal dropped below', () => {
  const dropped = {
    mode: 'keep',
    targetTenths: 45,
    previous: { displayedTenths: 45, status: 'holding', knownStatus: 'holding' },
    status: 'dropped_below',
    displayedTenths: 44,
  } as const

  it('is told once, in place of the tenth lost', () => {
    expect(decide(dropped).notices).toEqual([
      { transition: 'keep_dropped_below', targetTenths: 45, shownTenths: 44 },
    ])
  })

  it('is not told again while it stays below, nor after a wait for Google', () => {
    const below = { displayedTenths: 44, knownStatus: 'dropped_below' } as const

    expect(
      transitions({ ...dropped, previous: { ...below, status: 'dropped_below' } }),
    ).toEqual([])
    expect(
      transitions({ ...dropped, previous: { ...below, status: 'waiting_for_google' } }),
    ).toEqual([])
  })

  it('is told after a wait for Google when it was holding before the wait', () => {
    expect(
      transitions({
        ...dropped,
        previous: {
          displayedTenths: 45,
          status: 'waiting_for_google',
          knownStatus: 'holding',
        },
      }),
    ).toEqual(['keep_dropped_below'])
  })
})

describe('entered Below pace', () => {
  it('says the pace of the last four weeks against the goal’s pace', () => {
    expect(
      decide({
        status: 'below_pace',
        pace: { reviews: 26, window: { start: daysAgo(28), end: NOW } },
      }).notices,
    ).toEqual([
      {
        transition: 'entered_below_pace',
        targetTenths: 45,
        pacePerWeek: 11,
        recentPaceTenths: 65,
        paceWindow: 'last_4_weeks',
      },
    ])
  })

  it('counts since the goal was set while it is younger than four weeks', () => {
    const [notice] = decide({
      previous: { status: 'getting_started', knownStatus: 'getting_started' },
      status: 'below_pace',
      pace: { reviews: 10, window: { start: daysAgo(14), end: NOW } },
    }).notices

    expect(notice).toMatchObject({ recentPaceTenths: 50, paceWindow: 'since_set' })
  })

  it('rounds the pace down, so it never reads as the goal’s pace', () => {
    // 39.9 a month is 9.975 a week: shown as 9.9, never 10.0 against a pace of 11.
    const [notice] = decide({
      status: 'below_pace',
      pace: { reviews: 39, window: { start: daysAgo(27.4), end: NOW } },
    }).notices

    expect(notice).toMatchObject({ recentPaceTenths: 99, paceWindow: 'since_set' })
  })

  it('records when it was told', () => {
    expect(decide({ status: 'below_pace' })).toMatchObject({
      knownStatus: 'below_pace',
      belowPaceNoticedAt: NOW,
    })
  })

  it(`is told at most once every ${BELOW_PACE_NOTICE_DAYS} days`, () => {
    expect(BELOW_PACE_NOTICE_DAYS).toBe(14)
    const told = (days: number) => ({ belowPaceNoticedAt: daysAgo(days) })

    expect(transitions({ previous: told(13.9), status: 'below_pace' })).toEqual([])
    expect(decide({ previous: told(13.9), status: 'below_pace' })).toMatchObject({
      knownStatus: 'below_pace',
      belowPaceNoticedAt: daysAgo(13.9),
    })
    expect(transitions({ previous: told(14), status: 'below_pace' })).toEqual([
      'entered_below_pace',
    ])
  })

  it('is not told again while the goal stays below pace, nor after a wait for Google', () => {
    const below = { knownStatus: 'below_pace', belowPaceNoticedAt: daysAgo(30) } as const

    expect(
      transitions({ previous: { ...below, status: 'below_pace' }, status: 'below_pace' }),
    ).toEqual([])
    expect(
      transitions({
        previous: { ...below, status: 'waiting_for_google' },
        status: 'below_pace',
      }),
    ).toEqual([])
  })

  it('is told when the goal leaves getting started or too low reviews for below pace', () => {
    for (const knownStatus of [
      'getting_started',
      'reviews_too_low',
      'on_pace',
    ] as const) {
      expect(transitions({ previous: { knownStatus }, status: 'below_pace' })).toEqual([
        'entered_below_pace',
      ])
    }
  })

  it('is not told while waiting, getting started, reached or with reviews too low', () => {
    for (const status of [
      'waiting_for_google',
      'getting_started',
      'reviews_too_low',
    ] as const) {
      expect(transitions({ status }).filter((t) => t === 'entered_below_pace')).toEqual(
        [],
      )
    }
    expect(
      transitions({ status: 'reached', displayedTenths: 45, outcome: 'reached' }),
    ).toEqual(['reached'])
  })
})

describe('entered New reviews too low', () => {
  it('says the target and no star figure, not even the recent average', () => {
    expect(decide({ status: 'reviews_too_low' }).notices).toEqual([
      { transition: 'entered_reviews_too_low', targetTenths: 45 },
    ])
  })

  it('records when it was told', () => {
    expect(decide({ status: 'reviews_too_low' })).toMatchObject({
      knownStatus: 'reviews_too_low',
      tooLowNoticedAt: NOW,
      belowPaceNoticedAt: null,
    })
  })

  it(`is told at most once every ${TOO_LOW_NOTICE_DAYS} days`, () => {
    expect(TOO_LOW_NOTICE_DAYS).toBe(14)
    const told = (days: number) => ({ tooLowNoticedAt: daysAgo(days) })

    expect(transitions({ previous: told(13.9), status: 'reviews_too_low' })).toEqual([])
    expect(decide({ previous: told(13.9), status: 'reviews_too_low' })).toMatchObject({
      knownStatus: 'reviews_too_low',
      tooLowNoticedAt: daysAgo(13.9),
    })
    expect(transitions({ previous: told(14), status: 'reviews_too_low' })).toEqual([
      'entered_reviews_too_low',
    ])
  })

  it('keeps its own clock apart from the Below pace one', () => {
    const toldBelowPace = { belowPaceNoticedAt: daysAgo(1) }
    const toldTooLow = { tooLowNoticedAt: daysAgo(1) }

    expect(transitions({ previous: toldBelowPace, status: 'reviews_too_low' })).toEqual([
      'entered_reviews_too_low',
    ])
    expect(transitions({ previous: toldTooLow, status: 'below_pace' })).toEqual([
      'entered_below_pace',
    ])
    expect(decide({ previous: toldTooLow, status: 'below_pace' })).toMatchObject({
      belowPaceNoticedAt: NOW,
      tooLowNoticedAt: daysAgo(1),
    })
  })

  it('is not told again while reviews stay too low, nor after a wait for Google', () => {
    const out = { knownStatus: 'reviews_too_low' } as const

    expect(
      transitions({
        previous: { ...out, status: 'reviews_too_low' },
        status: 'reviews_too_low',
      }),
    ).toEqual([])
    expect(
      transitions({
        previous: { ...out, status: 'waiting_for_google' },
        status: 'reviews_too_low',
      }),
    ).toEqual([])
  })

  it('comes with the tenth lost when both change at once', () => {
    expect(transitions({ status: 'reviews_too_low', displayedTenths: 42 })).toEqual([
      'google_rating_changed',
      'entered_reviews_too_low',
    ])
  })
})

describe('a status the goal has not known before', () => {
  it('is stored without a notice: a set or a changed plan starts from it', () => {
    expect(
      decide({ previous: { knownStatus: null }, status: 'reviews_too_low' }),
    ).toEqual({
      notices: [],
      knownStatus: 'reviews_too_low',
      belowPaceNoticedAt: null,
      tooLowNoticedAt: null,
    })
    expect(
      transitions({ previous: { knownStatus: null }, status: 'below_pace' }),
    ).toEqual([])
  })

  it('keeps the last known status through a wait for Google', () => {
    expect(
      decide({ status: 'waiting_for_google', displayedTenths: null }).knownStatus,
    ).toBe('on_pace')
  })
})

describe('an evaluation that ends the goal', () => {
  it('tells nobody: an ended goal sends none of the five notices', () => {
    expect(
      decide({ status: 'below_pace', displayedTenths: 41, outcome: 'ended' }),
    ).toEqual({
      notices: [],
      knownStatus: 'on_pace',
      belowPaceNoticedAt: null,
      tooLowNoticedAt: null,
    })
  })

  it('keeps both notice times as they were', () => {
    const previous = {
      belowPaceNoticedAt: daysAgo(20),
      tooLowNoticedAt: daysAgo(3),
    }

    expect(
      decide({ previous, status: 'reviews_too_low', outcome: 'ended' }),
    ).toMatchObject(previous)
  })
})
