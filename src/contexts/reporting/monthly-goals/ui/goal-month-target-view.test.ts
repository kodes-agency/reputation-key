import { describe, expect, it } from 'vitest'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import {
  FIXTURE_ZONE,
  NOVEMBER,
  OCTOBER,
  goalBundle,
  monthRow,
  targetChange,
  version,
} from './goal-month-target.stories.fixtures'
import { goalListTarget } from './goal-month-target-view'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-22T09:00:00.000Z')
const frame = { timezone: FIXTURE_ZONE, now: NOW }

type Goal = ReturnType<typeof goalBundle>
const listOf = (goal: Goal, now = NOW) =>
  goalListTarget(goal, monthTargetPlan(goal, now, FIXTURE_ZONE), { ...frame, now })

// October runs under the first version, at 400.
const counting = () =>
  goalBundle({ versions: [version('v1', 1)], results: [monthRow('lobby', 'v1')] })

// On the 20th Marco changed October to 300 and left the months after alone.
const changedThisMonthOnly = () =>
  goalBundle({
    versions: [version('v1', 1)],
    results: [monthRow('lobby', 'v1', OCTOBER, { targetValue: 300 })],
    targetChanges: [targetChange('lobby', 400, 300, at('2026-10-20T08:00:00.000Z'))],
  })

// The same change, also for the months after: a version from November at 300.
const changedAndFollowing = () =>
  goalBundle({
    versions: [
      version('v1', 1, { effectiveTo: NOVEMBER.start }),
      version('v2', 2, {
        targetValue: 300,
        effectiveFrom: NOVEMBER.start,
        changeReason: 'target_changed',
        createdBy: 'marco',
        createdAt: at('2026-10-20T08:00:00.000Z'),
      }),
    ],
    results: [monthRow('lobby', 'v1', OCTOBER, { targetValue: 300 })],
    targetChanges: [
      targetChange('lobby', 400, 300, at('2026-10-20T08:00:00.000Z'), {
        followingOutcome: 'applied',
        followingVersionId: 'v2',
      }),
    ],
  })

// A revision on the 12th: 500 from November. October still runs at 400.
const revisedFromNovember = (patch: Parameters<typeof version>[2] = {}) =>
  goalBundle({
    versions: [
      version('v1', 1, { effectiveTo: NOVEMBER.start }),
      version('v2', 2, {
        targetValue: 500,
        effectiveFrom: NOVEMBER.start,
        changeReason: 'revised',
        createdAt: at('2026-10-12T08:00:00.000Z'),
        ...patch,
      }),
    ],
    results: [monthRow('lobby', 'v1')],
  })

describe('goalListTarget', () => {
  it('says the target, and when it was set, for a goal nothing has changed on', () => {
    expect(listOf(counting())).toEqual({
      metric: 'qualified_scans',
      text: 'target 400',
      setAt: at('2026-09-20T08:00:00.000Z'),
    })
  })

  it('says the changed target is this month’s, with the day and what it started at', () => {
    expect(listOf(changedAndFollowing())).toEqual({
      metric: 'qualified_scans',
      text: 'target 300 this month · changed Oct 20, started at 400',
      setAt: null,
    })
  })

  it('says what the months after go back to when only this month changed', () => {
    expect(listOf(changedThisMonthOnly()).text).toBe(
      'target 300 this month · changed Oct 20, started at 400 · 400 from Nov 1',
    )
  })

  it('shows this month’s target, not the one a revision set for next month', () => {
    // The day sits beside the target it dates: a "set on" at the end of the
    // row would read as the day the 500 was set.
    expect(listOf(revisedFromNovember())).toEqual({
      metric: 'qualified_scans',
      text: 'target 400 this month, set on Sep 20 · 500 from Nov 1',
      setAt: null,
    })
  })

  it('names the measure of the months after when it is another one', () => {
    const goal = revisedFromNovember({
      metric: 'portal_rating_average',
      targetValue: 4.5,
      metricMinimumSample: 10,
    })

    expect(listOf(goal).text).toBe(
      'target 400 this month, set on Sep 20 · Average private rating 4.5 from Nov 1',
    )
  })

  it('reads the head version’s target while no month is running', () => {
    const scheduled = goalBundle({
      status: 'scheduled',
      versions: [
        version('v1', 1, {
          effectiveFrom: NOVEMBER.start,
          createdAt: at('2026-10-21T08:00:00.000Z'),
        }),
      ],
    })

    expect(listOf(scheduled)).toEqual({
      metric: 'qualified_scans',
      text: 'target 400',
      setAt: at('2026-10-21T08:00:00.000Z'),
    })
  })

  it('promises a paused goal its months after only if it is resumed', () => {
    const changed = changedThisMonthOnly()
    const paused = {
      ...changed,
      program: { ...changed.program, status: 'paused' as const },
    }

    expect(listOf(paused).text).toBe(
      'target 300 this month · changed Oct 20, started at 400 · 400 from Nov 1 if resumed',
    )
  })

  it('promises no months after for a goal that has ended', () => {
    const changed = changedThisMonthOnly()
    const ended = {
      ...changed,
      program: { ...changed.program, status: 'ended' as const },
    }

    expect(listOf(ended).text).toBe(
      'target 300 this month · changed Oct 20, started at 400',
    )
  })
})
