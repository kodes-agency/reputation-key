import { describe, expect, it } from 'vitest'
import type { GoalMetric } from '../../domain/goal-program'
import {
  changeGoalMonthTargetFormSchema,
  changeGoalMonthTargetSchema,
} from './goal-month-target.dto'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const PROGRAM_ID = '20000000-0000-4000-8000-000000000001'

/** What the form says under its fields, as `field: message` lines. */
function refused(metric: GoalMetric, targetValue: number, note = ''): readonly string[] {
  const parsed = changeGoalMonthTargetFormSchema(metric).safeParse({
    targetValue,
    applyToFollowing: true,
    note,
  })
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

describe('the form of a month target change', () => {
  it('takes a whole number for a count and one decimal for an average', () => {
    expect(refused('qualified_scans', 300)).toEqual([])
    expect(refused('portal_rating_count', 25)).toEqual([])
    expect(refused('portal_rating_average', 4.5)).toEqual([])
  })

  it('says the measure’s own rule under the target before anything is sent', () => {
    expect(refused('qualified_scans', 4.5)).toEqual([
      'targetValue: Use a positive whole number',
    ])
    expect(refused('portal_rating_count', 0)).toEqual([
      'targetValue: Use a positive whole number',
    ])
    expect(refused('portal_rating_average', 5.5)).toEqual([
      'targetValue: Use a rating target from 1 to 5',
    ])
    expect(refused('portal_rating_average', 4.55)).toEqual([
      'targetValue: Use no more than one decimal place',
    ])
  })

  it('names an empty field once, as a target to enter', () => {
    // A cleared number control reads as NaN.
    expect(refused('qualified_scans', Number.NaN)).toEqual([
      'targetValue: Enter a valid monthly target',
    ])
  })

  it('holds the note to the length the command takes', () => {
    expect(refused('qualified_scans', 300, 'n'.repeat(500))).toEqual([])
    expect(refused('qualified_scans', 300, 'n'.repeat(501))).toHaveLength(1)
  })

  it('hands back one schema per measure, so the form keeps its validator', () => {
    expect(changeGoalMonthTargetFormSchema('qualified_scans')).toBe(
      changeGoalMonthTargetFormSchema('qualified_scans'),
    )
    expect(changeGoalMonthTargetFormSchema('qualified_scans')).not.toBe(
      changeGoalMonthTargetFormSchema('portal_rating_average'),
    )
  })

  it('sends what the command schema accepts', () => {
    const form = changeGoalMonthTargetFormSchema('qualified_scans').parse({
      targetValue: 300,
      applyToFollowing: false,
      note: '  Pool bar closed  ',
    })

    const command = changeGoalMonthTargetSchema.parse({
      propertyId: PROPERTY_ID,
      programId: PROGRAM_ID,
      month: '2026-10',
      expectedTarget: 400,
      expectedVersion: 1,
      ...form,
    })

    expect(command).toMatchObject({
      targetValue: 300,
      applyToFollowing: false,
      note: 'Pool bar closed',
    })
  })
})
