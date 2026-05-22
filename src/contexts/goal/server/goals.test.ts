// Goal context — server function DTO validation tests
// Tests zod schemas parse valid inputs and reject invalid inputs.

import { describe, it, expect } from 'vitest'
import {
  createGoalSchema,
  updateGoalSchema,
  cancelGoalSchema,
  listGoalsSchema,
  getGoalSchema,
} from '#/contexts/goal/application/dto/goal.dto'
import { goalError, isGoalError } from '#/contexts/goal/domain/errors'

// ── createGoalSchema ──────────────────────────────────────────────────

describe('createGoalSchema', () => {
  const validInput = {
    propertyId: 'prop-1',
    name: 'Get 50 reviews',
    goalType: 'one_shot' as const,
    aggregationFunction: 'sum' as const,
    metricKey: 'portal.scan' as const,
    targetValue: 50,
  }

  it('parses valid minimal input', () => {
    const result = createGoalSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('parses valid full input with all optional fields', () => {
    const input = {
      ...validInput,
      portalId: 'portal-1',
      teamId: 'team-1',
      staffId: 'staff-1',
      description: 'Increase scans',
      periodStart: '2026-01-01T00:00:00',
      periodEnd: '2026-12-31T23:59:59',
      recurrenceRule: { frequency: 'monthly' as const },
      rollingWindowDays: 30,
    }
    const result = createGoalSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects missing propertyId', () => {
    const { propertyId: _, ...noProp } = validInput
    const result = createGoalSchema.safeParse(noProp)
    expect(result.success).toBe(false)
  })

  it('rejects missing name', () => {
    const { name: _, ...noName } = validInput
    const result = createGoalSchema.safeParse(noName)
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = createGoalSchema.safeParse({ ...validInput, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects missing goalType', () => {
    const { goalType: _, ...noType } = validInput
    const result = createGoalSchema.safeParse(noType)
    expect(result.success).toBe(false)
  })

  it('rejects invalid goalType', () => {
    const result = createGoalSchema.safeParse({ ...validInput, goalType: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('rejects missing metricKey', () => {
    const { metricKey: _, ...noKey } = validInput
    const result = createGoalSchema.safeParse(noKey)
    expect(result.success).toBe(false)
  })

  it('rejects invalid metricKey', () => {
    const result = createGoalSchema.safeParse({ ...validInput, metricKey: 'invalid.key' })
    expect(result.success).toBe(false)
  })

  it('rejects missing targetValue', () => {
    const { targetValue: _, ...noTarget } = validInput
    const result = createGoalSchema.safeParse(noTarget)
    expect(result.success).toBe(false)
  })

  it('rejects zero targetValue', () => {
    const result = createGoalSchema.safeParse({ ...validInput, targetValue: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects negative targetValue', () => {
    const result = createGoalSchema.safeParse({ ...validInput, targetValue: -5 })
    expect(result.success).toBe(false)
  })

  it('rejects string targetValue', () => {
    const result = createGoalSchema.safeParse({ ...validInput, targetValue: '50' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid aggregationFunction', () => {
    const result = createGoalSchema.safeParse({
      ...validInput,
      aggregationFunction: 'median',
    })
    expect(result.success).toBe(false)
  })
})

// ── updateGoalSchema ──────────────────────────────────────────────────

describe('updateGoalSchema', () => {
  it('parses valid input with goalId only', () => {
    const result = updateGoalSchema.safeParse({ goalId: 'goal-1' })
    expect(result.success).toBe(true)
  })

  it('parses valid input with targetValue', () => {
    const result = updateGoalSchema.safeParse({ goalId: 'goal-1', targetValue: 100 })
    expect(result.success).toBe(true)
  })

  it('parses valid input with recurrenceRule', () => {
    const result = updateGoalSchema.safeParse({
      goalId: 'goal-1',
      recurrenceRule: { frequency: 'weekly' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing goalId', () => {
    const result = updateGoalSchema.safeParse({ targetValue: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects empty goalId', () => {
    const result = updateGoalSchema.safeParse({ goalId: '' })
    expect(result.success).toBe(false)
  })

  it('rejects zero targetValue', () => {
    const result = updateGoalSchema.safeParse({ goalId: 'goal-1', targetValue: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid recurrenceRule frequency', () => {
    const result = updateGoalSchema.safeParse({
      goalId: 'goal-1',
      recurrenceRule: { frequency: 'yearly' },
    })
    expect(result.success).toBe(false)
  })
})

// ── cancelGoalSchema ──────────────────────────────────────────────────

describe('cancelGoalSchema', () => {
  it('parses valid input', () => {
    const result = cancelGoalSchema.safeParse({ goalId: 'goal-1' })
    expect(result.success).toBe(true)
  })

  it('rejects missing goalId', () => {
    const result = cancelGoalSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty goalId', () => {
    const result = cancelGoalSchema.safeParse({ goalId: '' })
    expect(result.success).toBe(false)
  })
})

// ── listGoalsSchema ───────────────────────────────────────────────────

describe('listGoalsSchema', () => {
  it('parses valid minimal input', () => {
    const result = listGoalsSchema.safeParse({ propertyId: 'prop-1' })
    expect(result.success).toBe(true)
  })

  it('parses valid full input', () => {
    const input = {
      propertyId: 'prop-1',
      portalId: 'portal-1',
      teamId: 'team-1',
      staffId: 'staff-1',
      status: 'active' as const,
      goalType: 'rolling' as const,
    }
    const result = listGoalsSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects missing propertyId', () => {
    const result = listGoalsSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects invalid status', () => {
    const result = listGoalsSchema.safeParse({ propertyId: 'prop-1', status: 'pending' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid goalType', () => {
    const result = listGoalsSchema.safeParse({ propertyId: 'prop-1', goalType: 'daily' })
    expect(result.success).toBe(false)
  })
})

// ── getGoalSchema ─────────────────────────────────────────────────────

describe('getGoalSchema', () => {
  it('parses valid input', () => {
    const result = getGoalSchema.safeParse({ goalId: 'goal-1' })
    expect(result.success).toBe(true)
  })

  it('rejects missing goalId', () => {
    const result = getGoalSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty goalId', () => {
    const result = getGoalSchema.safeParse({ goalId: '' })
    expect(result.success).toBe(false)
  })
})

// ── isGoalError type guard ────────────────────────────────────────────

describe('isGoalError type guard', () => {
  it('returns true for GoalError', () => {
    const err = goalError('not_found', 'Goal not found')
    expect(isGoalError(err)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isGoalError(new Error('fail'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isGoalError(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isGoalError(undefined)).toBe(false)
  })

  it('returns false for string', () => {
    expect(isGoalError('not an error')).toBe(false)
  })
})
