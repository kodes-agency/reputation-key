import { describe, expect, it } from 'vitest'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import {
  DECEMBER,
  FIXTURE_ZONE,
  NOVEMBER,
  OCTOBER,
  goalBundle,
  monthRow,
  personName,
  targetChange,
  version,
} from './goal-month-target.stories.fixtures'
import { goalListTarget, goalTargetLines } from './goal-month-target-view'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-22T09:00:00.000Z')
const frame = { timezone: FIXTURE_ZONE, now: NOW, personName }

type Goal = ReturnType<typeof goalBundle>
const linesOf = (goal: Goal, now = NOW) =>
  goalTargetLines(goal, monthTargetPlan(goal, now, FIXTURE_ZONE), { ...frame, now })
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

describe('goalTargetLines', () => {
  it('shows this month and the months after separately while a month runs', () => {
    expect(linesOf(counting())).toEqual([
      { label: 'This month', value: '400', notes: [] },
      { label: 'From Nov 1', value: '400', notes: [] },
    ])
  })

  it('shows the old value beside a changed month, and the months after on their own target', () => {
    expect(linesOf(changedThisMonthOnly())).toEqual([
      {
        label: 'This month',
        value: '300',
        notes: ['Changed by Marco Rossi on Oct 20, started at 400'],
      },
      { label: 'From Nov 1', value: '400', notes: [] },
    ])
  })

  it('shows a change that also applies next month on both lines', () => {
    expect(linesOf(changedAndFollowing())).toEqual([
      {
        label: 'This month',
        value: '300',
        notes: ['Changed by Marco Rossi on Oct 20, started at 400'],
      },
      { label: 'From Nov 1', value: '300', notes: ['set on Oct 20'] },
    ])
  })

  it('keeps this month on its own target while a revision waits for the next one', () => {
    expect(linesOf(revisedFromNovember())).toEqual([
      { label: 'This month', value: '400', notes: [] },
      { label: 'From Nov 1', value: '500', notes: ['set on Oct 12'] },
    ])
  })

  it('names each measure when the change that waits has another one', () => {
    const goal = revisedFromNovember({
      metric: 'portal_rating_average',
      targetValue: 4.5,
      metricMinimumSample: 10,
    })

    expect(linesOf(goal)).toEqual([
      { label: 'This month', value: '400', notes: ['Qualified scans'] },
      {
        label: 'From Nov 1',
        value: '4.5',
        notes: ['Private rating average', 'set on Oct 12'],
      },
    ])
  })

  it('dates the months after from the day their target starts, not from next month', () => {
    const goal = revisedFromNovember({ effectiveFrom: DECEMBER.start })

    expect(linesOf(goal).at(1)).toEqual({
      label: 'From Dec 1',
      value: '500',
      notes: ['set on Oct 12'],
    })
  })

  it('shows one target while no month is running', () => {
    const scheduled = goalBundle({
      status: 'scheduled',
      versions: [version('v1', 1, { effectiveFrom: NOVEMBER.start })],
    })

    expect(linesOf(scheduled)).toEqual([{ label: 'Target', value: '400', notes: [] }])
  })

  it('shows no months after for a goal that has ended', () => {
    const ended = { ...changedThisMonthOnly() }
    const goal = { ...ended, program: { ...ended.program, status: 'ended' as const } }

    expect(linesOf(goal)).toEqual([
      {
        label: 'This month',
        value: '300',
        notes: ['Changed by Marco Rossi on Oct 20, started at 400'],
      },
    ])
  })

  it('promises a paused goal its months after only if it is resumed', () => {
    const changed = changedThisMonthOnly()
    const paused = {
      ...changed,
      program: { ...changed.program, status: 'paused' as const },
    }

    // A paused goal opens no month until it is resumed.
    expect(linesOf(paused).map((line) => line.label)).toEqual([
      'This month',
      'From Nov 1, if resumed',
    ])
  })

  it('shows no marker for a month changed back to the target it started with', () => {
    const goal = goalBundle({
      versions: [version('v1', 1)],
      results: [monthRow('lobby', 'v1')],
      targetChanges: [
        targetChange('lobby', 400, 300, at('2026-10-20T08:00:00.000Z')),
        targetChange('lobby', 300, 400, at('2026-10-21T08:00:00.000Z')),
      ],
    })

    expect(linesOf(goal).at(0)).toEqual({ label: 'This month', value: '400', notes: [] })
  })
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
      'target 400 this month, set on Sep 20 · Private rating average 4.5 from Nov 1',
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
