import { describe, expect, it } from 'vitest'
import type { GoalMetric, GoalSubject } from '../domain/goal-program'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from './ports/goal-program.repository'
import {
  isPropertyCountGoal,
  monthlyPortalGoalOf,
  portalGoalPageOf,
} from './monthly-portal-goal-identity'

// Seaview, Sofia time: November runs from Oct 31 22:00 UTC to Nov 30 22:00 UTC.
const OCT_23 = new Date('2026-10-23T09:00:00.000Z')
const NOV_1 = new Date('2026-10-31T22:00:00.000Z')
const NOV_12 = new Date('2026-11-12T10:00:00.000Z')
const NOV_22 = new Date('2026-11-22T10:00:00.000Z')
const DEC_1 = new Date('2026-11-30T22:00:00.000Z')
const DEC_1_NOON = new Date('2026-12-01T10:00:00.000Z')
const DEC_3 = new Date('2026-12-03T10:00:00.000Z')

const property: GoalSubject = { kind: 'property', propertyId: 'property-1' }
const reception: GoalSubject = { kind: 'portal', portalId: 'portal-reception' }
const rooms: GoalSubject = { kind: 'portal_group', portalGroupId: 'group-rooms' }

type Shape = Readonly<{
  id: string
  createdAt?: Date
  status?: GoalProgramBundle['program']['status']
  metric?: GoalMetric
  subjects?: readonly GoalSubject[]
  /** Where the current version's assignments close; null while open-ended. */
  until?: Date | null
  updatedAt?: Date
  months?: readonly GoalMonthlyResult['status'][]
}>

function goal(shape: Shape): GoalProgramBundle {
  const createdAt = shape.createdAt ?? OCT_23
  const metric = shape.metric ?? 'portal_rating_count'
  const version: GoalProgramVersion = {
    id: `${shape.id}-v1`,
    programId: shape.id,
    organizationId: 'org-1',
    propertyId: 'property-1',
    version: 1,
    metricDefinitionId: 'definition-1',
    metricDefinitionVersionId: 'definition-version-1',
    metric,
    metricMinimumSample: 0,
    targetValue: 40,
    propertyTimezone: 'Europe/Sofia',
    effectiveFrom: NOV_1,
    effectiveTo: shape.until ?? null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt,
  }
  const assignments = (shape.subjects ?? [property]).map(
    (subject, index): GoalSubjectAssignment => ({
      id: `${shape.id}-a${index + 1}`,
      programId: shape.id,
      programVersionId: version.id,
      organizationId: 'org-1',
      propertyId: 'property-1',
      metric,
      subject,
      effectiveFrom: NOV_1,
      effectiveTo: shape.until ?? null,
      createdBy: 'elena',
      createdAt,
    }),
  )
  const results = (shape.months ?? []).map((status, index): GoalMonthlyResult => ({
    id: `${shape.id}-m${index + 1}`,
    assignmentId: `${shape.id}-a1`,
    programId: shape.id,
    programVersionId: version.id,
    organizationId: 'org-1',
    propertyId: 'property-1',
    periodStart: NOV_1,
    periodEnd: DEC_1,
    propertyTimezone: 'Europe/Sofia',
    status,
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
    closedAt: status === 'closed' ? DEC_1_NOON : null,
    createdAt: NOV_1,
    updatedAt: NOV_1,
  }))
  return {
    program: {
      id: shape.id,
      organizationId: 'org-1',
      propertyId: 'property-1',
      name: 'Monthly portal goal',
      description: null,
      status: shape.status ?? 'active',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt,
      updatedAt: shape.updatedAt ?? createdAt,
    },
    version,
    versions: [version],
    assignments,
    results,
  }
}

/** Stopped on Nov 12: its version and assignment close where November ends. */
const stoppedOnNov12 = (id: string, months: Shape['months'] = ['open']) =>
  goal({ id, status: 'ended', until: DEC_1, updatedAt: NOV_12, months })

describe('monthlyPortalGoalOf', () => {
  it('the earliest non-ended Property count goal is the monthly goal', () => {
    const later = goal({
      id: 'scans',
      metric: 'qualified_scans',
      createdAt: new Date('2026-10-24T09:00:00.000Z'),
    })
    const first = goal({ id: 'ratings', status: 'scheduled' })

    expect(monthlyPortalGoalOf([later, first], OCT_23)?.program.id).toBe('ratings')
    expect(monthlyPortalGoalOf([], OCT_23)).toBeNull()
  })

  it('an average is never the monthly goal', () => {
    const average = goal({ id: 'average', metric: 'portal_rating_average' })

    expect(monthlyPortalGoalOf([average], NOV_22)).toBeNull()
  })

  it('a portal or group goal is never the monthly goal', () => {
    const portal = goal({ id: 'reception', subjects: [reception] })
    const group = goal({ id: 'rooms', subjects: [rooms] })
    const monthly = goal({
      id: 'monthly',
      createdAt: new Date('2026-10-25T09:00:00.000Z'),
    })

    expect(monthlyPortalGoalOf([portal, group], NOV_22)).toBeNull()
    expect(monthlyPortalGoalOf([portal, group, monthly], NOV_22)?.program.id).toBe(
      'monthly',
    )
  })

  it('a goal stopped on Nov 12 is still the monthly goal until November closes', () => {
    const stopped = stoppedOnNov12('stopped')

    expect(monthlyPortalGoalOf([stopped], NOV_22)?.program.id).toBe('stopped')
    // Past Nov 30 its window is over, but November still reconciles.
    const reconciling = stoppedOnNov12('stopped', ['reconciling'])
    expect(monthlyPortalGoalOf([reconciling], DEC_1_NOON)?.program.id).toBe('stopped')
    // A goal that has not stopped comes first.
    const running = goal({ id: 'running', createdAt: NOV_12 })
    expect(monthlyPortalGoalOf([stopped, running], NOV_22)?.program.id).toBe('running')
  })

  it('the most recently stopped of two still counting is the monthly goal', () => {
    const earlier = goal({
      id: 'earlier',
      status: 'ended',
      until: DEC_1,
      updatedAt: new Date('2026-11-05T10:00:00.000Z'),
      months: ['open'],
    })
    const later = stoppedOnNov12('later')

    expect(monthlyPortalGoalOf([later, earlier], NOV_22)?.program.id).toBe('later')
    expect(monthlyPortalGoalOf([earlier, later], NOV_22)?.program.id).toBe('later')
  })

  it('after it closes, none', () => {
    const closed = stoppedOnNov12('stopped', ['closed'])

    expect(monthlyPortalGoalOf([closed], DEC_3)).toBeNull()
    // Never started, so it ended where it would have begun and holds no month.
    const neverStarted = goal({ id: 'never', status: 'ended', until: NOV_1 })
    expect(monthlyPortalGoalOf([neverStarted], OCT_23)).toBeNull()
  })
})

describe('isPropertyCountGoal', () => {
  it('a count goal for the Property alone, on either measure', () => {
    expect(isPropertyCountGoal(goal({ id: 'ratings' }))).toBe(true)
    expect(isPropertyCountGoal(goal({ id: 'scans', metric: 'qualified_scans' }))).toBe(
      true,
    )
    // Stopped or not, it is still a Property count goal: its page is the card.
    expect(isPropertyCountGoal(stoppedOnNov12('stopped'))).toBe(true)
  })

  it('never an average, a Portal or a group goal, or one with the Property among others', () => {
    expect(
      isPropertyCountGoal(goal({ id: 'average', metric: 'portal_rating_average' })),
    ).toBe(false)
    expect(isPropertyCountGoal(goal({ id: 'reception', subjects: [reception] }))).toBe(
      false,
    )
    expect(isPropertyCountGoal(goal({ id: 'rooms', subjects: [rooms] }))).toBe(false)
    expect(
      isPropertyCountGoal(goal({ id: 'mixed', subjects: [property, reception] })),
    ).toBe(false)
  })
})

describe('portalGoalPageOf (PG-21)', () => {
  it('a Property count goal is the Monthly portal goal: its page is /goals/portals', () => {
    expect(portalGoalPageOf(goal({ id: 'ratings' }))).toEqual({ kind: 'monthly' })
    expect(portalGoalPageOf(stoppedOnNov12('stopped'))).toEqual({ kind: 'monthly' })
  })

  it('a count goal for one Portal or one group has the page of its subject', () => {
    expect(portalGoalPageOf(goal({ id: 'reception', subjects: [reception] }))).toEqual({
      kind: 'subject',
      subject: reception,
    })
    expect(
      portalGoalPageOf(
        goal({ id: 'rooms', subjects: [rooms], metric: 'qualified_scans' }),
      ),
    ).toEqual({ kind: 'subject', subject: rooms })
  })

  it('the average has the page of an average, whatever its one subject', () => {
    expect(
      portalGoalPageOf(goal({ id: 'average', metric: 'portal_rating_average' })),
    ).toEqual({ kind: 'average', subject: property })
  })

  it('a goal for several subjects has no page of its own', () => {
    expect(
      portalGoalPageOf(goal({ id: 'mixed', subjects: [property, reception] })),
    ).toBeNull()
    expect(portalGoalPageOf(goal({ id: 'two', subjects: [reception, rooms] }))).toBeNull()
  })
})
