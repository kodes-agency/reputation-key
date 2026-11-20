import { describe, expect, it } from 'vitest'
import {
  changeRatingGoalSchema,
  keepRatingGoalPaceSchema,
  setRatingGoalSchema,
} from './rating-goal.contracts'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const GOAL_ID = '00000000-0000-4000-8000-000000000003'
const climb = {
  propertyId: PROPERTY_ID,
  mode: 'climb' as const,
  targetTenths: 45,
  qualityTenths: 47,
  paceTenthsPerWeek: 110,
}

describe('Property Google rating goal week', () => {
  it('takes a Keep’s week only as a date', () => {
    const input = { propertyId: PROPERTY_ID, goalId: GOAL_ID, weekStart: '2026-10-05' }

    expect(keepRatingGoalPaceSchema.safeParse(input).success).toBe(true)
    expect(
      keepRatingGoalPaceSchema.safeParse({ ...input, weekStart: 'last week' }).success,
    ).toBe(false)
    expect(
      keepRatingGoalPaceSchema.safeParse({ ...input, weekStart: '2026-10-05T00:00:00Z' })
        .success,
    ).toBe(false)
  })
})

describe('Property Google rating goal input', () => {
  it('needs a pace and a planned quality to climb, and neither to keep', () => {
    const keep = { ...climb, mode: 'keep', qualityTenths: null, paceTenthsPerWeek: null }

    expect(setRatingGoalSchema.safeParse(climb).success).toBe(true)
    expect(
      setRatingGoalSchema.safeParse({ ...climb, paceTenthsPerWeek: null }).success,
    ).toBe(false)
    expect(setRatingGoalSchema.safeParse({ ...climb, qualityTenths: null }).success).toBe(
      false,
    )
    expect(setRatingGoalSchema.safeParse(keep).success).toBe(true)
    expect(
      setRatingGoalSchema.safeParse({ ...keep, paceTenthsPerWeek: 110 }).success,
    ).toBe(false)
    expect(setRatingGoalSchema.safeParse({ ...keep, qualityTenths: 47 }).success).toBe(
      false,
    )
  })

  it('takes a planned quality in tenths up to five stars', () => {
    for (const qualityTenths of [51, 46.5]) {
      expect(setRatingGoalSchema.safeParse({ ...climb, qualityTenths }).success).toBe(
        false,
      )
    }
    expect(setRatingGoalSchema.safeParse({ ...climb, qualityTenths: 50 }).success).toBe(
      true,
    )
  })

  it('takes a target in tenths from 1.0 to 5.0 and a pace from 1 a week to 50 a day', () => {
    for (const targetTenths of [9, 51, 44.5]) {
      expect(setRatingGoalSchema.safeParse({ ...climb, targetTenths }).success).toBe(
        false,
      )
    }
    for (const paceTenthsPerWeek of [9, 3501, 10.5]) {
      expect(setRatingGoalSchema.safeParse({ ...climb, paceTenthsPerWeek }).success).toBe(
        false,
      )
    }
    for (const paceTenthsPerWeek of [10, 3500]) {
      expect(setRatingGoalSchema.safeParse({ ...climb, paceTenthsPerWeek }).success).toBe(
        true,
      )
    }
    expect(
      setRatingGoalSchema.safeParse({ ...climb, propertyId: 'not-a-uuid' }).success,
    ).toBe(false)
  })

  it('refuses a change that names nothing to change', () => {
    const identity = { propertyId: PROPERTY_ID, goalId: GOAL_ID, expectedVersion: 1 }

    expect(changeRatingGoalSchema.safeParse(identity).success).toBe(false)
    expect(changeRatingGoalSchema.safeParse({ ...identity, mode: 'keep' }).success).toBe(
      true,
    )
    expect(
      changeRatingGoalSchema.safeParse({ ...identity, qualityTenths: 48 }).success,
    ).toBe(true)
    expect(
      changeRatingGoalSchema.safeParse({
        ...identity,
        expectedVersion: 0,
        targetTenths: 46,
      }).success,
    ).toBe(false)
  })
})

// Legacy: one release, dropped with pace_per_week (contract follow-up). A page
// opened before the release still sends whole reviews a week as `pacePerWeek`.
// The validator maps it before a use case sees the request.
describe('Property Google rating goal input from a page opened before the release', () => {
  const identity = { propertyId: PROPERTY_ID, goalId: GOAL_ID, expectedVersion: 1 }
  const { paceTenthsPerWeek: _tenths, ...legacyClimb } = climb

  it('applies a change of target, quality and a whole weekly pace together', () => {
    expect(
      changeRatingGoalSchema.parse({
        ...identity,
        targetTenths: 46,
        qualityTenths: 48,
        pacePerWeek: 11,
      }),
    ).toEqual({
      ...identity,
      targetTenths: 46,
      qualityTenths: 48,
      paceTenthsPerWeek: 110,
    })
  })

  it('sets a goal from a whole weekly pace', () => {
    expect(setRatingGoalSchema.parse({ ...legacyClimb, pacePerWeek: 3 })).toEqual({
      ...legacyClimb,
      paceTenthsPerWeek: 30,
    })
  })

  it('switches to keep without a pace, either way it is named', () => {
    const toKeep = { ...identity, mode: 'keep', targetTenths: 49, qualityTenths: null }

    expect(changeRatingGoalSchema.parse({ ...toKeep, pacePerWeek: null })).toEqual({
      ...toKeep,
      paceTenthsPerWeek: null,
    })
    expect(changeRatingGoalSchema.parse({ ...toKeep, paceTenthsPerWeek: null })).toEqual({
      ...toKeep,
      paceTenthsPerWeek: null,
    })
    expect(changeRatingGoalSchema.parse(toKeep)).toEqual(toKeep)
  })

  it('refuses the pace sent both ways', () => {
    expect(
      changeRatingGoalSchema.safeParse({
        ...identity,
        pacePerWeek: 11,
        paceTenthsPerWeek: 110,
      }).success,
    ).toBe(false)
    expect(setRatingGoalSchema.safeParse({ ...climb, pacePerWeek: 11 }).success).toBe(
      false,
    )
  })

  it('takes a whole weekly pace from 1 to 200 only', () => {
    for (const pacePerWeek of [0, 201, 2.5]) {
      expect(setRatingGoalSchema.safeParse({ ...legacyClimb, pacePerWeek }).success).toBe(
        false,
      )
      expect(changeRatingGoalSchema.safeParse({ ...identity, pacePerWeek }).success).toBe(
        false,
      )
    }
    expect(
      setRatingGoalSchema.safeParse({ ...legacyClimb, pacePerWeek: 200 }).success,
    ).toBe(true)
  })

  it('still needs a pace to climb and none to keep', () => {
    expect(setRatingGoalSchema.safeParse(legacyClimb).success).toBe(false)
    expect(
      setRatingGoalSchema.safeParse({
        ...legacyClimb,
        mode: 'keep',
        qualityTenths: null,
        pacePerWeek: 3,
      }).success,
    ).toBe(false)
  })
})
