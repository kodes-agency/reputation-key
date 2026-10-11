import { describe, expect, it } from 'vitest'
import type { GoalMetric, GoalSubject } from '../domain/goal-program'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
  GoalSubjectAssignment,
} from './ports/goal-program.repository'
import { assignmentHoldsFrom, holdOutlasts, subjectHolds } from './goal-subject-holds'

const OCTOBER = new Date('2026-10-01T00:00:00.000Z')
const NOVEMBER = new Date('2026-11-01T00:00:00.000Z')
const DECEMBER = new Date('2026-12-01T00:00:00.000Z')
const lobby: GoalSubject = { kind: 'portal', portalId: 'portal-lobby' }
const bar: GoalSubject = { kind: 'portal', portalId: 'portal-bar' }

type Window = Readonly<{
  subject: GoalSubject
  from: Date
  to: Date | null
  metric?: GoalMetric
}>

function program(id: string, windows: readonly Window[]): GoalProgramBundle {
  const version: GoalProgramVersion = {
    id: `${id}-v1`,
    programId: id,
    organizationId: 'org-1',
    propertyId: 'property-1',
    version: 1,
    metricDefinitionId: 'definition-1',
    metricDefinitionVersionId: 'definition-version-1',
    metric: 'portal_rating_count',
    metricMinimumSample: 0,
    targetValue: 400,
    propertyTimezone: 'UTC',
    effectiveFrom: OCTOBER,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt: OCTOBER,
  }
  const assignments = windows.map((window, index): GoalSubjectAssignment => ({
    id: `${id}-a${index + 1}`,
    programId: id,
    programVersionId: version.id,
    organizationId: 'org-1',
    propertyId: 'property-1',
    metric: window.metric ?? 'portal_rating_count',
    subject: window.subject,
    effectiveFrom: window.from,
    effectiveTo: window.to,
    createdBy: 'elena',
    createdAt: OCTOBER,
  }))
  return {
    program: {
      id,
      organizationId: 'org-1',
      propertyId: 'property-1',
      name: `Goal ${id}`,
      description: null,
      status: 'active',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt: OCTOBER,
      updatedAt: OCTOBER,
    },
    version,
    versions: [version],
    assignments,
    results: [],
  }
}

describe('assignmentHoldsFrom', () => {
  it('holds while open-ended, and until its end when it has one', () => {
    expect(
      assignmentHoldsFrom({ effectiveFrom: OCTOBER, effectiveTo: null }, DECEMBER),
    ).toBe(true)
    const ending = { effectiveFrom: OCTOBER, effectiveTo: NOVEMBER }
    expect(assignmentHoldsFrom(ending, OCTOBER)).toBe(true)
    expect(assignmentHoldsFrom(ending, new Date(NOVEMBER.getTime() - 1))).toBe(true)
    // Half-open: the subject is free from the end instant itself.
    expect(assignmentHoldsFrom(ending, NOVEMBER)).toBe(false)
  })

  it('an empty window holds nothing, even before it begins', () => {
    const cancelled = { effectiveFrom: NOVEMBER, effectiveTo: NOVEMBER }
    expect(assignmentHoldsFrom(cancelled, OCTOBER)).toBe(false)
    expect(assignmentHoldsFrom(cancelled, NOVEMBER)).toBe(false)
  })
})

describe('holdOutlasts', () => {
  it('an open-ended hold outlasts any that ends, and nothing outlasts it', () => {
    expect(holdOutlasts(null, NOVEMBER)).toBe(true)
    expect(holdOutlasts(DECEMBER, NOVEMBER)).toBe(true)
    expect(holdOutlasts(NOVEMBER, NOVEMBER)).toBe(false)
    expect(holdOutlasts(NOVEMBER, DECEMBER)).toBe(false)
    expect(holdOutlasts(DECEMBER, null)).toBe(false)
    expect(holdOutlasts(null, null)).toBe(false)
  })
})

describe('subjectHolds', () => {
  it('names the live goal that holds a subject', () => {
    const holds = subjectHolds(
      [program('ratings', [{ subject: lobby, from: OCTOBER, to: null }])],
      'portal_rating_count',
      OCTOBER,
    )

    expect(holds).toEqual([
      { subject: lobby, programName: 'Goal ratings', heldUntil: null },
    ])
  })

  it('a goal ended this month holds its subject until the month ends', () => {
    const ended = program('ended', [{ subject: lobby, from: OCTOBER, to: NOVEMBER }])

    expect(subjectHolds([ended], 'portal_rating_count', OCTOBER)).toEqual([
      { subject: lobby, programName: 'Goal ended', heldUntil: NOVEMBER },
    ])
    expect(subjectHolds([ended], 'portal_rating_count', NOVEMBER)).toEqual([])
  })

  it('a goal cancelled before its start holds nothing', () => {
    const cancelled = program('cancelled', [
      { subject: lobby, from: NOVEMBER, to: NOVEMBER },
    ])

    expect(subjectHolds([cancelled], 'portal_rating_count', OCTOBER)).toEqual([])
  })

  it('another measure does not hold the subject', () => {
    const scans = program('scans', [
      { subject: lobby, from: OCTOBER, to: null, metric: 'qualified_scans' },
    ])

    expect(subjectHolds([scans], 'portal_rating_count', OCTOBER)).toEqual([])
    expect(subjectHolds([scans], 'qualified_scans', OCTOBER)).toHaveLength(1)
  })

  it('reports each held subject once, by the hold that lasts longest', () => {
    const ending = program('ending', [{ subject: lobby, from: OCTOBER, to: NOVEMBER }])
    const successor = program('successor', [
      { subject: lobby, from: NOVEMBER, to: null },
      { subject: bar, from: NOVEMBER, to: DECEMBER },
    ])

    const holds = subjectHolds([ending, successor], 'portal_rating_count', OCTOBER)

    expect(holds).toEqual([
      { subject: lobby, programName: 'Goal successor', heldUntil: null },
      { subject: bar, programName: 'Goal successor', heldUntil: DECEMBER },
    ])
  })
})
