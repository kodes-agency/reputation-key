import { describe, expect, it } from 'vitest'
import type { GoalMetric, GoalProgramStatus } from '../domain/goal-program'
import type {
  GoalMonthlyResult,
  GoalMonthTargetChange,
  GoalProgramBundle,
  GoalProgramVersion,
} from './ports/goal-program.repository'
import { monthTargetPlan } from './goal-month-target-plan'

const MARCH = new Date('2026-03-01T00:00:00.000Z')
const APRIL = new Date('2026-04-01T00:00:00.000Z')
const MAY = new Date('2026-05-01T00:00:00.000Z')
const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
// Sofia is three hours ahead of UTC in summer: its May begins on 30 April UTC.
const SOFIA_MAY = new Date('2026-04-30T21:00:00.000Z')
// New York is four hours behind UTC in April.
const NEW_YORK_APRIL = new Date('2026-04-01T04:00:00.000Z')

const version = (
  id: string,
  number: number,
  patch: Partial<GoalProgramVersion> = {},
): GoalProgramVersion => ({
  id,
  programId: 'program-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  version: number,
  metricDefinitionId: 'definition-1',
  metricDefinitionVersionId: 'definition-version-1',
  metric: 'qualified_scans' as GoalMetric,
  metricMinimumSample: 0,
  targetValue: 400,
  propertyTimezone: 'UTC',
  effectiveFrom: MARCH,
  effectiveTo: null,
  changeReason: 'created',
  createdBy: 'manager-1',
  createdAt: new Date('2026-02-20T00:00:00.000Z'),
  ...patch,
})

const month = (
  id: string,
  versionId: string,
  patch: Partial<GoalMonthlyResult> = {},
): GoalMonthlyResult => ({
  id,
  assignmentId: `assignment-${id}`,
  programId: 'program-1',
  programVersionId: versionId,
  organizationId: 'org-1',
  propertyId: 'property-1',
  periodStart: MARCH,
  periodEnd: APRIL,
  propertyTimezone: 'UTC',
  status: 'open',
  targetValue: null,
  evaluation: {
    state: 'updating',
    value: null,
    sampleCount: 0,
    achieved: null,
    reason: 'period_open',
  },
  sourceCompleteThrough: null,
  evaluationWatermark: null,
  closedAt: null,
  createdAt: MARCH,
  updatedAt: MARCH,
  ...patch,
})

const change = (
  monthlyResultId: string,
  previousTargetValue: number,
  newTargetValue: number,
  createdAt: Date,
): GoalMonthTargetChange => ({
  id: `change-${monthlyResultId}-${createdAt.getTime()}`,
  organizationId: 'org-1',
  propertyId: 'property-1',
  programId: 'program-1',
  monthlyResultId,
  changeId: `command-${createdAt.getTime()}`,
  previousTargetValue,
  newTargetValue,
  followingOutcome: 'not_requested',
  followingReason: null,
  followingVersionId: null,
  note: null,
  createdBy: 'manager-1',
  createdAt,
})

function goal(
  input: Readonly<{
    status?: GoalProgramStatus
    versions: readonly GoalProgramVersion[]
    results?: readonly GoalMonthlyResult[]
    targetChanges?: readonly GoalMonthTargetChange[]
  }>,
): GoalProgramBundle {
  const head = input.versions.at(-1)
  if (!head) throw new Error('a goal has at least one version')
  return {
    program: {
      id: 'program-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      name: 'Lobby scans',
      description: null,
      status: input.status ?? 'active',
      statusReason: null,
      currentVersion: head.version,
      createdBy: 'manager-1',
      createdAt: head.createdAt,
      updatedAt: head.createdAt,
    },
    version: head,
    versions: input.versions,
    assignments: [],
    results: input.results ?? [],
    targetChanges: input.targetChanges ?? [],
  }
}

describe('monthTargetPlan', () => {
  it('finds the running months, their version and the target they are judged against', () => {
    const inForce = version('v1', 1)
    const running = goal({
      versions: [inForce],
      results: [month('lobby', 'v1'), month('pool', 'v1')],
    })

    expect(monthTargetPlan(running, MID_MARCH, 'UTC')).toEqual({
      monthKey: '2026-03',
      period: { start: MARCH, end: APRIL },
      runningRows: running.results,
      inForceVersion: inForce,
      effectiveTarget: 400,
      startTarget: 400,
      changeCount: 0,
      pendingHead: null,
      followingStart: APRIL,
      skipsMonth: false,
      canApplyFollowing: true,
      followingBlockedReason: null,
    })
  })

  it('a scheduled goal has no running month', () => {
    const scheduled = goal({
      status: 'scheduled',
      versions: [version('v1', 1, { effectiveFrom: APRIL })],
    })

    expect(monthTargetPlan(scheduled, MID_MARCH, 'UTC')).toBeNull()
  })

  it('a month past its end is not running, even while it is still open', () => {
    const ended = goal({ versions: [version('v1', 1)], results: [month('lobby', 'v1')] })

    expect(monthTargetPlan(ended, APRIL, 'UTC')).toBeNull()
    expect(monthTargetPlan(ended, new Date(APRIL.getTime() - 1), 'UTC')).not.toBeNull()
  })

  it('a reconciling or closed month is not running', () => {
    for (const status of ['reconciling', 'closed'] as const) {
      const settled = goal({
        versions: [version('v1', 1)],
        results: [month('lobby', 'v1', { status })],
      })

      expect(monthTargetPlan(settled, MID_MARCH, 'UTC')).toBeNull()
    }
  })

  it('reports the month’s own target, the target it started with and the number of changes', () => {
    const changed = goal({
      versions: [version('v1', 1)],
      results: [month('lobby', 'v1', { targetValue: 250 })],
      targetChanges: [
        change('lobby', 400, 300, new Date('2026-03-05T09:00:00.000Z')),
        change('lobby', 300, 250, new Date('2026-03-12T09:00:00.000Z')),
      ],
    })

    expect(monthTargetPlan(changed, MID_MARCH, 'UTC')).toMatchObject({
      effectiveTarget: 250,
      startTarget: 400,
      changeCount: 2,
    })
  })

  it('reads the running month under the version in force when a change waits for its month', () => {
    const inForce = version('v1', 1, { effectiveTo: APRIL })
    const pending = version('v2', 2, { targetValue: 500, effectiveFrom: APRIL })
    const waiting = goal({
      versions: [inForce, pending],
      results: [month('lobby', 'v1')],
    })

    expect(monthTargetPlan(waiting, MID_MARCH, 'UTC')).toMatchObject({
      inForceVersion: inForce,
      effectiveTarget: 400,
      pendingHead: pending,
      followingStart: APRIL,
      canApplyFollowing: true,
      followingBlockedReason: null,
    })
  })

  it('a scheduled change with another measure cannot take the month’s target', () => {
    const inForce = version('v1', 1, { effectiveTo: APRIL })
    const pending = version('v2', 2, {
      metric: 'portal_rating_average',
      targetValue: 4.5,
      effectiveFrom: APRIL,
    })
    const waiting = goal({
      versions: [inForce, pending],
      results: [month('lobby', 'v1')],
    })

    expect(monthTargetPlan(waiting, MID_MARCH, 'UTC')).toMatchObject({
      pendingHead: pending,
      canApplyFollowing: false,
      followingBlockedReason: 'scheduled_change_has_other_measure',
    })
  })

  it('the following months start after a month that still has to reconcile', () => {
    const running = goal({
      versions: [
        version('v1', 1, { effectiveFrom: new Date('2026-02-01T00:00:00.000Z') }),
      ],
      results: [
        month('february', 'v1', {
          periodStart: new Date('2026-02-01T00:00:00.000Z'),
          periodEnd: MARCH,
          status: 'reconciling',
        }),
        month('march', 'v1'),
      ],
    })

    expect(monthTargetPlan(running, MID_MARCH, 'UTC')).toMatchObject({
      runningRows: [expect.objectContaining({ id: 'march' })],
      followingStart: APRIL,
    })
  })

  it('after the Property moved east the following start skips a local month', () => {
    // Sofia's April begins before the UTC March ends, so the next version can
    // start only with Sofia's May, and Sofia's April has no result.
    const running = goal({
      versions: [version('v1', 1)],
      results: [month('lobby', 'v1')],
    })

    expect(monthTargetPlan(running, MID_MARCH, 'Europe/Sofia')).toMatchObject({
      followingStart: SOFIA_MAY,
      skipsMonth: true,
    })
  })

  it('names the running month on the calendar it was cut in, not the Property’s new one', () => {
    // A Sofia month: it began on 28 February UTC, and is still Sofia's March
    // after the Property moved to New York.
    const sofiaMarch = month('lobby', 'v1', {
      periodStart: new Date('2026-02-28T22:00:00.000Z'),
      periodEnd: new Date('2026-03-31T21:00:00.000Z'),
      propertyTimezone: 'Europe/Sofia',
    })
    const running = goal({
      versions: [
        version('v1', 1, {
          propertyTimezone: 'Europe/Sofia',
          effectiveFrom: sofiaMarch.periodStart,
        }),
      ],
      results: [sofiaMarch],
    })

    expect(monthTargetPlan(running, MID_MARCH, 'America/New_York')).toMatchObject({
      monthKey: '2026-03',
      skipsMonth: false,
    })
  })

  it('after the Property moved west the following month starts hours later, and none is skipped', () => {
    const running = goal({
      versions: [version('v1', 1)],
      results: [month('lobby', 'v1')],
    })

    expect(monthTargetPlan(running, MID_MARCH, 'America/New_York')).toMatchObject({
      followingStart: NEW_YORK_APRIL,
      skipsMonth: false,
    })
  })

  it('a paused goal keeps the month that was running when it was paused', () => {
    const paused = goal({
      status: 'paused',
      versions: [version('v1', 1)],
      results: [month('lobby', 'v1')],
    })

    expect(monthTargetPlan(paused, MID_MARCH, 'UTC')).toMatchObject({
      effectiveTarget: 400,
      followingStart: APRIL,
    })
    // April never opened for the paused goal: nothing is running in it.
    expect(monthTargetPlan(paused, new Date(MAY.getTime() - 1), 'UTC')).toBeNull()
  })
})
