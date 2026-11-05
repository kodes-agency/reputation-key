import { describe, expect, it } from 'vitest'
import {
  changeGoalProgramStatusSchema,
  createGoalProgramSchema,
} from './goal-program.dto'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const PORTAL_ID = '00000000-0000-4000-8000-000000000002'
const PROGRAM_ID = '00000000-0000-4000-8000-000000000003'
const subject = { kind: 'portal' as const, portalId: PORTAL_ID }
const creation = {
  propertyId: PROPERTY_ID,
  name: 'Monthly ratings',
  description: null,
  metric: 'portal_rating_average' as const,
  targetValue: 4.5,
  subjects: [subject],
}

describe('Goal Program command DTOs', () => {
  it('accepts the complete create contract', () => {
    expect(createGoalProgramSchema.safeParse(creation).success).toBe(true)
  })

  it.each([{ name: ' ' }, { subjects: [] }])(
    'rejects an invalid creation (%j)',
    (patch) => {
      expect(createGoalProgramSchema.safeParse({ ...creation, ...patch }).success).toBe(
        false,
      )
    },
  )

  it('takes a status change without a note, and trims and bounds one that is given', () => {
    const change = { propertyId: PROPERTY_ID, programId: PROGRAM_ID, status: 'paused' }
    expect(changeGoalProgramStatusSchema.safeParse(change).success).toBe(true)
    expect(
      changeGoalProgramStatusSchema.parse({ ...change, reason: '  Agreed  ' }).reason,
    ).toBe('Agreed')
    expect(
      changeGoalProgramStatusSchema.safeParse({ ...change, reason: 'x'.repeat(501) })
        .success,
    ).toBe(false)
  })
})
