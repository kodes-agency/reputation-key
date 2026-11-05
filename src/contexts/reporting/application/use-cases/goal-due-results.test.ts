import { describe, expect, it } from 'vitest'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import { dueResultsForProgram, openResultsForPeriods } from './goal-program-shared'

const MARCH = new Date('2026-02-28T22:00:00Z')
const APRIL = new Date('2026-03-31T21:00:00Z')
const MAY = new Date('2026-04-30T21:00:00Z')
const STOP = new Date('2026-03-31T21:10:00Z')

function fixture(): GoalProgramBundle {
  const version = {
    id: 'version',
    programId: 'program',
    organizationId: 'org',
    propertyId: 'property',
    version: 1,
    metricDefinitionId: 'definition',
    metricDefinitionVersionId: 'metric-version',
    metric: 'portal_rating_count' as const,
    metricMinimumSample: 0,
    targetValue: 10,
    propertyTimezone: 'Europe/Sofia',
    effectiveFrom: MARCH,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'manager',
    createdAt: MARCH,
  }
  return {
    program: {
      id: 'program',
      organizationId: 'org',
      propertyId: 'property',
      name: 'Ratings',
      description: null,
      status: 'active',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'manager',
      createdAt: MARCH,
      updatedAt: MARCH,
    },
    version,
    versions: [version],
    assignments: ['first', 'second'].map((id) => ({
      id,
      programId: 'program',
      programVersionId: version.id,
      organizationId: 'org',
      propertyId: 'property',
      metric: version.metric,
      subject: { kind: 'portal', portalId: id },
      effectiveFrom: MARCH,
      effectiveTo: null,
      createdBy: 'manager',
      createdAt: MARCH,
    })),
    results: [],
  }
}

const id = () => 'new-result'

describe('due Goal months', () => {
  it('opens the month at 00:10 before hourly maintenance, across the DST boundary', () => {
    const bundle = fixture()
    const results = openResultsForPeriods(
      bundle,
      [{ start: MARCH, end: APRIL }],
      id,
      MARCH,
    )
    const due = dueResultsForProgram({ ...bundle, results }, id, STOP)
    expect(due).toHaveLength(2)
    expect(due.map((result) => result.assignmentId)).toEqual(['first', 'second'])
    for (const result of due) {
      expect(result).toMatchObject({
        periodStart: APRIL,
        periodEnd: MAY,
        propertyTimezone: 'Europe/Sofia',
        status: 'open',
        targetValue: null,
        evaluation: { state: 'updating' },
      })
    }
  })

  it('catches up each subject independently without duplicating an existing month', () => {
    const bundle = fixture()
    const results = openResultsForPeriods(
      bundle,
      [{ start: MARCH, end: APRIL }],
      id,
      MARCH,
    ).filter((result) => result.assignmentId === 'first')
    const due = dueResultsForProgram({ ...bundle, results }, id, STOP)
    expect(due.map((result) => [result.assignmentId, result.periodStart])).toEqual([
      ['first', APRIL],
      ['second', MARCH],
      ['second', APRIL],
    ])
    expect(
      dueResultsForProgram({ ...bundle, results: [...results, ...due] }, id, STOP),
    ).toEqual([])
  })

  it('does not open a future version or a month outside an assignment window', () => {
    const bundle = fixture()
    expect(
      dueResultsForProgram(
        { ...bundle, version: { ...bundle.version, effectiveFrom: MAY } },
        id,
        STOP,
      ),
    ).toEqual([])
    const ended = {
      ...bundle,
      assignments: bundle.assignments.map((assignment) => ({
        ...assignment,
        effectiveTo: APRIL,
      })),
    }
    expect(
      dueResultsForProgram(ended, id, STOP).map((result) => result.periodStart),
    ).toEqual([MARCH, MARCH])
  })

  it('keeps average goals and their historical assignments on their pinned version', () => {
    const bundle = fixture()
    const average = {
      ...bundle,
      version: {
        ...bundle.version,
        metric: 'portal_rating_average' as const,
        metricMinimumSample: 10,
      },
      assignments: [
        ...bundle.assignments.map((assignment) => ({
          ...assignment,
          metric: 'portal_rating_average' as const,
        })),
        { ...bundle.assignments[0]!, id: 'historical', programVersionId: 'old-version' },
      ],
    }
    const due = dueResultsForProgram(average, id, MARCH)
    expect(due.map((result) => result.assignmentId)).toEqual(['first', 'second'])
    expect(due.every((result) => result.programVersionId === 'version')).toBe(true)
  })
})
