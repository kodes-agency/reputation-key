import { describe, expect, it } from 'vitest'
import type { RatingGoalStatus } from './rating-goal'
import { weeklyRecapDue, type RecapGoal } from './rating-goal-recap'

const SOFIA = 'Europe/Sofia'
// Set on Wednesday 7 Oct 2026, 10:00 in Sofia.
const SET_AT = new Date('2026-10-07T07:00:00.000Z')

const goal = (overrides: Partial<RecapGoal> = {}): RecapGoal => ({
  mode: 'climb',
  state: 'active',
  paceTenthsPerWeek: 70,
  createdAt: SET_AT,
  paceSince: SET_AT,
  recapAnsweredWeek: null,
  ...overrides,
})

const due = (
  now: string,
  overrides: Partial<RecapGoal> = {},
  status: RatingGoalStatus = 'on_pace',
  googleShowsSoon = false,
) =>
  weeklyRecapDue({
    goal: goal(overrides),
    status,
    googleShowsSoon,
    now: new Date(now),
    timezone: SOFIA,
  })

describe('when the Monday check-in shows (Q4, E29)', () => {
  it('shows all week, from Monday 00:00 to Sunday 23:59 in the Property’s zone', () => {
    // Monday 19 Oct 00:00 in Sofia (UTC+3) is 21:00 UTC on Sunday.
    expect(due('2026-10-18T21:00:00.000Z')).toEqual({
      weekStart: '2026-10-12',
      compared: true,
    })
    // Wednesday 21 Oct, and Sunday 25 Oct at 23:59 (UTC+2 by then).
    expect(due('2026-10-21T09:00:00.000Z')?.weekStart).toBe('2026-10-12')
    expect(due('2026-10-25T21:59:00.000Z')?.weekStart).toBe('2026-10-12')
    // Monday 26 Oct 00:00 in Sofia, after the clocks went back.
    expect(due('2026-10-25T22:00:00.000Z')?.weekStart).toBe('2026-10-19')
  })

  it('turns at Monday 00:00 across the clocks going forward', () => {
    const spring = { createdAt: new Date('2026-03-02T09:00:00.000Z') }
    const sinceSpring = { ...spring, paceSince: spring.createdAt }

    // Sunday 29 Mar at 23:59 in Sofia (UTC+3 since 04:00) is 20:59 UTC.
    expect(due('2026-03-29T20:59:00.000Z', sinceSpring)?.weekStart).toBe('2026-03-16')
    expect(due('2026-03-29T21:00:00.000Z', sinceSpring)?.weekStart).toBe('2026-03-23')
  })

  it('waits for a whole week after the set', () => {
    // Monday 12 Oct: last week began on 5 Oct, before the Wednesday it was set.
    expect(due('2026-10-12T09:00:00.000Z')).toBeNull()
    expect(due('2026-10-19T09:00:00.000Z')).not.toBeNull()
  })

  it('is gone once a manager kept last week’s pace', () => {
    expect(
      due('2026-10-21T09:00:00.000Z', { recapAnsweredWeek: '2026-10-12' }),
    ).toBeNull()
    // An answer to an earlier week does not answer this one.
    expect(
      due('2026-10-21T09:00:00.000Z', { recapAnsweredWeek: '2026-10-05' }),
    ).not.toBeNull()
  })

  it('counts a pace changed this week as the answer', () => {
    // Changed on Tuesday 20 Oct.
    expect(
      due('2026-10-21T09:00:00.000Z', {
        paceSince: new Date('2026-10-20T08:00:00.000Z'),
      }),
    ).toBeNull()
  })

  it('states last week’s count alone when the pace changed during it', () => {
    // Changed on Thursday 15 Oct: last week had no single plan.
    expect(
      due('2026-10-21T09:00:00.000Z', {
        paceSince: new Date('2026-10-15T08:00:00.000Z'),
      }),
    ).toEqual({ weekStart: '2026-10-12', compared: false })
    // Changed at last Monday's first instant: the whole week had today's pace.
    expect(
      due('2026-10-21T09:00:00.000Z', {
        paceSince: new Date('2026-10-11T21:00:00.000Z'),
      }),
    ).toEqual({ weekStart: '2026-10-12', compared: true })
  })

  it('shows for a goal getting started, on pace or below pace only', () => {
    const at = '2026-10-21T09:00:00.000Z'
    for (const status of ['getting_started', 'on_pace', 'below_pace'] as const) {
      expect(due(at, {}, status)).not.toBeNull()
    }
    for (const status of ['reviews_too_low', 'waiting_for_google', 'reached'] as const) {
      expect(due(at, {}, status)).toBeNull()
    }
  })

  it('stays hidden while Google lags on the goal itself', () => {
    expect(due('2026-10-21T09:00:00.000Z', {}, 'on_pace', true)).toBeNull()
  })

  it('never shows for a keep goal or a goal that is no longer active', () => {
    const at = '2026-10-21T09:00:00.000Z'

    expect(due(at, { mode: 'keep', paceTenthsPerWeek: null }, 'holding')).toBeNull()
    expect(due(at, { state: 'reached' })).toBeNull()
  })
})
