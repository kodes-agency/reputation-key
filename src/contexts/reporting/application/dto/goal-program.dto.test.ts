import { describe, expect, it } from 'vitest'
import {
  changeGoalProgramAssignmentsSchema,
  changeGoalProgramStatusSchema,
  createGoalProgramFormSchema,
  createGoalProgramSchema,
  goalProgramAssignmentEditorSchema,
  reviseGoalProgramFormSchema,
  reviseGoalProgramSchema,
} from './goal-program.dto'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const PORTAL_ID = '00000000-0000-4000-8000-000000000002'
const PROGRAM_ID = '00000000-0000-4000-8000-000000000003'
const subject = { kind: 'portal' as const, portalId: PORTAL_ID }

describe('Goal Program command DTOs', () => {
  it('owns the complete create and revision validation contract', () => {
    expect(
      createGoalProgramSchema.safeParse({
        propertyId: PROPERTY_ID,
        name: 'Monthly ratings',
        description: null,
        metric: 'portal_rating_average',
        targetValue: 4.5,
        subjects: [subject],
      }).success,
    ).toBe(true)
    expect(
      reviseGoalProgramSchema.safeParse({
        propertyId: PROPERTY_ID,
        programId: PROGRAM_ID,
        metric: 'portal_rating_count',
        targetValue: 20,
        subjects: [subject],
        reason: 'Raise the monthly target',
      }).success,
    ).toBe(true)
  })

  it('rejects blank names, missing subjects, and no-op assignment changes', () => {
    expect(
      createGoalProgramSchema.safeParse({
        propertyId: PROPERTY_ID,
        name: ' ',
        metric: 'qualified_scans',
        targetValue: 10,
        subjects: [],
      }).success,
    ).toBe(false)
    expect(
      createGoalProgramFormSchema.safeParse({
        name: 'Impossible average',
        metric: 'portal_rating_average',
        targetValue: 5.5,
        subjects: [subject],
      }).success,
    ).toBe(false)
    expect(
      changeGoalProgramAssignmentsSchema.safeParse({
        propertyId: PROPERTY_ID,
        programId: PROGRAM_ID,
        expectedVersion: 1,
        add: [],
        remove: [],
        selectAllCurrentPortals: false,
        reason: 'No change',
      }).success,
    ).toBe(false)
  })

  const revision = {
    propertyId: PROPERTY_ID,
    programId: PROGRAM_ID,
    metric: 'portal_rating_count' as const,
    targetValue: 20,
    subjects: [subject],
  }

  it('takes every change without a note, and trims and bounds one that is given', () => {
    expect(reviseGoalProgramSchema.safeParse(revision).success).toBe(true)
    expect(
      changeGoalProgramStatusSchema.safeParse({
        propertyId: PROPERTY_ID,
        programId: PROGRAM_ID,
        status: 'paused',
      }).success,
    ).toBe(true)
    expect(
      changeGoalProgramAssignmentsSchema.safeParse({
        propertyId: PROPERTY_ID,
        programId: PROGRAM_ID,
        expectedVersion: 1,
        add: [subject],
      }).success,
    ).toBe(true)

    expect(
      reviseGoalProgramSchema.parse({ ...revision, reason: '  Agreed  ' }).reason,
    ).toBe('Agreed')
    expect(
      reviseGoalProgramSchema.safeParse({ ...revision, reason: 'x'.repeat(501) }).success,
    ).toBe(false)
  })

  it('lets a form leave the note empty', () => {
    const { propertyId: _property, programId: _program, ...fields } = revision

    expect(reviseGoalProgramFormSchema.safeParse({ ...fields, reason: '' }).success).toBe(
      true,
    )
    expect(
      goalProgramAssignmentEditorSchema.safeParse({
        subjects: [subject],
        selectAllCurrentPortals: false,
        reason: '',
      }).success,
    ).toBe(true)
  })

  it('carries the version a revision form was opened on, as a command field only', () => {
    expect(
      reviseGoalProgramSchema.parse({ ...revision, expectedVersion: 3 }).expectedVersion,
    ).toBe(3)
    for (const invalid of [0, 1.5, '3']) {
      expect(
        reviseGoalProgramSchema.safeParse({ ...revision, expectedVersion: invalid })
          .success,
      ).toBe(false)
    }
    expect(reviseGoalProgramFormSchema.shape).not.toHaveProperty('expectedVersion')
  })
})
