import { describe, expect, it } from 'vitest'
import {
  changeGoalProgramAssignmentsSchema,
  createGoalProgramFormSchema,
  createGoalProgramSchema,
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
})
