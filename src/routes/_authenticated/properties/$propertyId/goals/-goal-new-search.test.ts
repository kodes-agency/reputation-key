import { describe, expect, it } from 'vitest'
import { newGoalSearchSchema } from './-goal-new-search'

describe('newGoalSearchSchema', () => {
  it('opens the single goal form when the address names no view', () => {
    expect(newGoalSearchSchema.parse({})).toEqual({})
  })

  it('reads the table that sets several goals from mode=several', () => {
    expect(newGoalSearchSchema.parse({ mode: 'several' })).toEqual({ mode: 'several' })
  })

  it('falls back to the single goal form for a view it does not know', () => {
    expect(newGoalSearchSchema.parse({ mode: 'many' }).mode).toBeUndefined()
    expect(newGoalSearchSchema.parse({ mode: 7 }).mode).toBeUndefined()
  })

  it('keeps the subject a link chose beside either view', () => {
    expect(
      newGoalSearchSchema.parse({ subject: 'portal_group:floor', mode: 'several' }),
    ).toEqual({ subject: 'portal_group:floor', mode: 'several' })
    // A subject too long to be one is dropped, and the view still opens.
    expect(
      newGoalSearchSchema.parse({ subject: 'x'.repeat(101), mode: 'several' }),
    ).toEqual({ mode: 'several' })
  })
})
