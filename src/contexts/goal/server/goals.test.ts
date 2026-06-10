// Goal context — server function tests
// Tests DTO validation, error→status mapping, and throwContextError construction.
// Imports the real goalErrorStatus from the server module to ensure tests break
// when production code changes.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createGoalSchema,
  updateGoalSchema,
  cancelGoalSchema,
  listGoalsSchema,
  getGoalSchema,
} from '#/contexts/goal/application/dto/goal.dto'
import { goalError, isGoalError } from '#/contexts/goal/domain/errors'
import type { GoalErrorCode } from '#/contexts/goal/domain/errors'
import { goalErrorStatus } from '#/contexts/goal/server/goals'
import { throwContextError } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'

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
      portalGroupId: 'group-1',
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
  it('rejects input with goalId only (no fields to update)', () => {
    const result = updateGoalSchema.safeParse({ goalId: 'goal-1' })
    expect(result.success).toBe(false)
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
      portalGroupId: 'group-1',
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

// ── Error → HTTP status mapping (production code) ─────────────────

describe('goalErrorStatus (imported from server module)', () => {
  it('maps forbidden → 403', () => {
    expect(goalErrorStatus('forbidden')).toBe(403)
  })

  it('maps not_found → 404', () => {
    expect(goalErrorStatus('not_found')).toBe(404)
  })

  it('maps validation_error → 400', () => {
    expect(goalErrorStatus('validation_error')).toBe(400)
  })

  it('maps immutable_goal → 409', () => {
    expect(goalErrorStatus('immutable_goal')).toBe(409)
  })

  it('all error codes are covered (exhaustive check)', () => {
    const codes: GoalErrorCode[] = [
      'forbidden',
      'not_found',
      'validation_error',
      'immutable_goal',
    ]
    for (const code of codes) {
      const status = goalErrorStatus(code)
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(500)
    }
  })
})

// ── throwContextError (shared server error helper) ─────────────────

describe('throwContextError with GoalError', () => {
  it('throws an Error with the domain message', () => {
    const e = goalError('not_found', 'Goal not found')
    expect(() => throwContextError('GoalError', e, goalErrorStatus(e.code))).toThrow(
      'Goal not found',
    )
  })

  it('sets error.name to GoalError', () => {
    const e = goalError('forbidden', 'Insufficient role')
    try {
      throwContextError('GoalError', e, goalErrorStatus(e.code))
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('GoalError')
    }
  })

  it('attaches code and status as custom properties', () => {
    const e = goalError('immutable_goal', 'Goal is completed')
    try {
      throwContextError('GoalError', e, goalErrorStatus(e.code))
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.code).toBe('immutable_goal')
      expect(error.status).toBe(409)
    }
  })

  it('preserves the correct status for every error code', () => {
    const cases: Array<[GoalErrorCode, number]> = [
      ['forbidden', 403],
      ['not_found', 404],
      ['validation_error', 400],
      ['immutable_goal', 409],
    ]
    for (const [code, expectedStatus] of cases) {
      const e = goalError(code, `test ${code}`)
      try {
        throwContextError('GoalError', e, goalErrorStatus(e.code))
      } catch (err) {
        const error = err as Error & { code: string; status: number }
        expect(error.status).toBe(expectedStatus)
        expect(error.code).toBe(code)
      }
    }
  })
})

// ── Permission checks ──────────────────────────────────────────────
// Verify that the can() function correctly gates goal.write and goal.read
// for authorized vs. unauthorized roles.

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(() => new Headers()),
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(() =>
    Promise.resolve({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'AccountAdmin',
    }),
  ),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    useCases: {
      createGoal: vi.fn(() => Promise.resolve({ _tag: 'ok', value: { id: 'goal-1' } })),
      listGoals: vi.fn(() => Promise.resolve([{ id: 'goal-1' }])),
      getGoal: vi.fn(() => Promise.resolve({ _tag: 'ok', value: { id: 'goal-1' } })),
    },
  })),
}))

describe('permission gates in goal server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('can() returns true for AccountAdmin + goal.create', () => {
    expect(can('AccountAdmin', 'goal.create')).toBe(true)
  })

  it('can() returns true for PropertyManager + goal.create', () => {
    expect(can('PropertyManager', 'goal.create')).toBe(true)
  })

  it('can() returns true for Staff + goal.create', () => {
    expect(can('Staff', 'goal.create')).toBe(true)
  })

  it('can() returns true for AccountAdmin + goal.read', () => {
    expect(can('AccountAdmin', 'goal.read')).toBe(true)
  })

  it('can() returns true for PropertyManager + goal.read', () => {
    expect(can('PropertyManager', 'goal.read')).toBe(true)
  })

  it('can() returns true for Staff + goal.read (Staff has read + create access)', () => {
    expect(can('Staff', 'goal.read')).toBe(true)
  })

  it('can() returns false for Staff + goal.update (Staff cannot update goals)', () => {
    expect(can('Staff', 'goal.update')).toBe(false)
  })

  it('unauthorized role would produce 403 via throwContextError', () => {
    const e = goalError('forbidden', 'No goal write permission')
    try {
      throwContextError('GoalError', e, goalErrorStatus(e.code))
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(403)
      expect(error.code).toBe('forbidden')
    }
  })
})
