import { describe, expect, it } from 'vitest'
import type {
  GoalMonthlyResult,
  GoalProgramVersion,
} from './ports/goal-program.repository'
import { goalTargetProvenance } from './goal-target-provenance'

const OCTOBER = new Date('2026-10-01T00:00:00.000Z')
const NOVEMBER = new Date('2026-11-01T00:00:00.000Z')
const DECEMBER = new Date('2026-12-01T00:00:00.000Z')

const version = (
  number: number,
  patch: Partial<GoalProgramVersion> = {},
): GoalProgramVersion => ({
  id: `version-${number}`,
  programId: 'program-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  version: number,
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
  createdAt: new Date('2026-10-11T09:00:00.000Z'),
  ...patch,
})

const result = (
  versionId: string,
  periodStart: Date,
): Pick<GoalMonthlyResult, 'programVersionId' | 'periodStart'> => ({
  programVersionId: versionId,
  periodStart,
})

describe('goalTargetProvenance', () => {
  it('reports who set the target, when, and the month it counts from', () => {
    const created = version(1)

    expect(
      goalTargetProvenance(
        { versions: [created], results: [result(created.id, OCTOBER)] },
        created,
      ),
    ).toEqual({
      setAt: new Date('2026-10-11T09:00:00.000Z'),
      setBy: 'elena',
      countsFrom: OCTOBER,
    })
  })

  it('set on survives a subjects-only change', () => {
    const created = version(1, { effectiveTo: NOVEMBER })
    // Marco changed the subjects on the 20th: same measure, same target.
    const subjectsChanged = version(2, {
      effectiveFrom: NOVEMBER,
      changeReason: 'subjects_changed',
      createdBy: 'marco',
      createdAt: new Date('2026-10-20T14:00:00.000Z'),
    })
    const bundle = {
      versions: [created, subjectsChanged],
      results: [result(created.id, OCTOBER)],
    }

    expect(goalTargetProvenance(bundle, subjectsChanged)).toEqual({
      setAt: new Date('2026-10-11T09:00:00.000Z'),
      setBy: 'elena',
      countsFrom: OCTOBER,
    })
  })

  it('a changed target is set by the version that changed it', () => {
    const created = version(1, { effectiveTo: DECEMBER })
    const raised = version(2, {
      targetValue: 500,
      effectiveFrom: DECEMBER,
      createdBy: 'marco',
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
    })
    const bundle = {
      versions: [created, raised],
      results: [result(created.id, OCTOBER), result(created.id, NOVEMBER)],
    }

    expect(goalTargetProvenance(bundle, raised)).toEqual({
      setAt: new Date('2026-11-15T10:00:00.000Z'),
      setBy: 'marco',
      // No month has been counted against 500 yet: its planned start.
      countsFrom: DECEMBER,
    })
    // The earlier months keep the provenance of the target they were judged by.
    expect(goalTargetProvenance(bundle, created)).toEqual({
      setAt: new Date('2026-10-11T09:00:00.000Z'),
      setBy: 'elena',
      countsFrom: OCTOBER,
    })
  })

  it('a changed measure starts a new run even with the same number', () => {
    const created = version(1, { targetValue: 4, effectiveTo: NOVEMBER })
    const average = version(2, {
      metric: 'portal_rating_average',
      targetValue: 4,
      effectiveFrom: NOVEMBER,
      createdBy: 'marco',
      createdAt: new Date('2026-10-20T14:00:00.000Z'),
    })

    expect(
      goalTargetProvenance({ versions: [created, average], results: [] }, average),
    ).toMatchObject({ setBy: 'marco', countsFrom: NOVEMBER })
  })

  it('a target set back to an earlier value is not credited to the earlier version', () => {
    const first = version(1, { effectiveTo: NOVEMBER })
    const raised = version(2, {
      targetValue: 500,
      effectiveFrom: NOVEMBER,
      effectiveTo: DECEMBER,
      createdBy: 'marco',
      createdAt: new Date('2026-10-20T14:00:00.000Z'),
    })
    const restored = version(3, {
      effectiveFrom: DECEMBER,
      createdBy: 'ana',
      createdAt: new Date('2026-11-18T08:00:00.000Z'),
    })

    expect(
      goalTargetProvenance(
        { versions: [first, raised, restored], results: [] },
        restored,
      ),
    ).toEqual({
      setAt: new Date('2026-11-18T08:00:00.000Z'),
      setBy: 'ana',
      countsFrom: DECEMBER,
    })
  })

  it('counts from is the first month with a result', () => {
    // Planned for October, but the first month that was opened is November.
    const created = version(1)
    const bundle = {
      versions: [created],
      results: [result(created.id, DECEMBER), result(created.id, NOVEMBER)],
    }

    expect(goalTargetProvenance(bundle, created).countsFrom).toEqual(NOVEMBER)
    // Before any month opens, it is the planned start.
    expect(
      goalTargetProvenance({ versions: [created], results: [] }, created).countsFrom,
    ).toEqual(OCTOBER)
  })

  it('reads versions in order whatever order the bundle lists them in', () => {
    const created = version(1, { effectiveTo: NOVEMBER })
    const subjectsChanged = version(2, {
      effectiveFrom: NOVEMBER,
      createdBy: 'marco',
      createdAt: new Date('2026-10-20T14:00:00.000Z'),
    })

    expect(
      goalTargetProvenance(
        { versions: [subjectsChanged, created], results: [] },
        subjectsChanged,
      ),
    ).toMatchObject({ setBy: 'elena', countsFrom: OCTOBER })
  })
})
