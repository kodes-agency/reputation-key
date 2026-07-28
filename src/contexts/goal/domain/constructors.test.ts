import { describe, it, expect } from 'vitest'
import { buildGoal } from './constructors'
import {
  organizationId,
  propertyId,
  portalId,
  portalGroupId,
  goalId,
  userId,
} from '#/shared/domain/ids'
import type { GoalType } from './types'

const BASE = {
  id: goalId('goal-1'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('prop-1'),
  portalId: null as ReturnType<typeof portalId> | null,
  portalGroupId: null as ReturnType<typeof portalGroupId> | null,
  name: 'Reach 4.5 average Google rating',
  description: null as string | null,
  createdBy: userId('user-1'),
  metricKey: 'property.review' as const,
  aggregationFunction: 'avg' as const,
  targetValue: 4.5,
  now: new Date('2026-06-01T12:00:00Z'),
}

describe('buildGoal', () => {
  // ── Goal type rules (integration) ──────────────────────────────
  // The exhaustive goalType × temporal-fields decision matrix moved to
  // goal-type-rules.test.ts (table-driven, at the new interface). These are
  // thin end-to-end pins through buildGoal: one happy path + one rejection
  // per goal type.
  describe('goal type rules (thin integration)', () => {
    it('creates an open goal at property scope', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
      })
      expect(result.isOk()).toBe(true)
      const goal = result._unsafeUnwrap()
      expect(goal.goalType).toBe('open')
      expect(goal.status).toBe('active')
      expect(goal.periodStart).toBeNull()
      expect(goal.periodEnd).toBeNull()
      expect(goal.recurrenceRule).toBeNull()
      expect(goal.rollingWindowDays).toBeNull()
      expect(goal.parentGoalId).toBeNull()
      expect(goal.completedAt).toBeNull()
    })

    it('rejects open goal with period dates', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('period_not_allowed')
    })

    it('creates a one-shot goal with period dates', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'one_shot',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      expect(result.isOk()).toBe(true)
      const goal = result._unsafeUnwrap()
      expect(goal.periodStart).toEqual(new Date('2026-06-01'))
      expect(goal.periodEnd).toEqual(new Date('2026-06-30'))
    })

    it('rejects one-shot goal without period dates', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'one_shot',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('period_required')
    })

    it('creates a rolling goal with window days', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'rolling',
        rollingWindowDays: 30,
      })
      expect(result.isOk()).toBe(true)
      const goal = result._unsafeUnwrap()
      expect(goal.rollingWindowDays).toBe(30)
      expect(goal.periodStart).toBeNull()
    })

    it('rejects rolling goal without rollingWindowDays', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'rolling',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('rolling_window_required')
    })

    it('creates a recurring template with recurrenceRule', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
      })
      expect(result.isOk()).toBe(true)
      const goal = result._unsafeUnwrap()
      expect(goal.recurrenceRule).toEqual({ frequency: 'monthly' })
      expect(goal.periodStart).toBeNull()
      expect(goal.periodEnd).toBeNull()
    })

    it('rejects recurring template with period dates', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('period_not_allowed')
    })

    it('allows recurring instance (parentGoalId set) with period dates', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
        parentGoalId: goalId('parent-1'),
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      expect(result.isOk()).toBe(true)
      const goal = result._unsafeUnwrap()
      expect(goal.parentGoalId).not.toBeNull()
    })
  })

  // ── Exhaustive goalType coverage ─────────────────────────────────────
  describe('exhaustive goalType switch', () => {
    const goalTypes: GoalType[] = ['open', 'one_shot', 'rolling', 'recurring']
    it('handles all four goal types without throwing', () => {
      for (const goalType of goalTypes) {
        const input: Parameters<typeof buildGoal>[0] = {
          ...BASE,
          goalType,
          // Provide required fields for each type
          ...(goalType === 'one_shot'
            ? {
                periodStart: new Date('2026-06-01'),
                periodEnd: new Date('2026-06-30'),
              }
            : {}),
          ...(goalType === 'rolling' ? { rollingWindowDays: 30 } : {}),
          ...(goalType === 'recurring'
            ? { recurrenceRule: { frequency: 'monthly' } }
            : {}),
        }
        const result = buildGoal(input)
        expect(result.isOk()).toBe(true)
        expect(result._unsafeUnwrap().goalType).toBe(goalType)
      }
    })
  })

  // ── Scope → metric key validation ───────────────────────────────────
  describe('scope constraints', () => {
    it('rejects portal_group scope with property.review metric', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        portalGroupId: portalGroupId('pg-1'),
        metricKey: 'property.review',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('invalid_metric_for_scope')
    })

    it('allows portal_group scope with portal.scan metric', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        portalGroupId: portalGroupId('pg-1'),
        metricKey: 'portal.scan' as const,
        aggregationFunction: 'sum' as const,
        targetValue: 200,
      })
      expect(result.isOk()).toBe(true)
    })

    it('rejects when multiple scope FKs are set (ambiguous scope)', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        portalId: portalId('portal-1'),
        portalGroupId: portalGroupId('pg-1'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('ambiguous_scope')
    })
  })

  // ── Metric key × aggregation validation ─────────────────────────────
  describe('metric × aggregation', () => {
    it('rejects AVG on portal.scan', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        portalId: portalId('portal-1'),
        metricKey: 'portal.scan',
        aggregationFunction: 'avg',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('invalid_aggregation_for_metric')
    })

    it('allows AVG on portal.rating', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        portalId: portalId('portal-1'),
        metricKey: 'portal.rating',
        aggregationFunction: 'avg',
      })
      expect(result.isOk()).toBe(true)
    })

    it('rejects SUM on portal.rating', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        portalId: portalId('portal-1'),
        metricKey: 'portal.rating',
        aggregationFunction: 'sum',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('invalid_aggregation_for_metric')
    })
  })

  // ── Field validation ─────────────────────────────────────────────────
  describe('field validation', () => {
    it('rejects empty name', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        name: '',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('empty_name')
    })

    it('rejects whitespace-only name', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        name: '   ',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('empty_name')
    })

    it('rejects zero targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: 0,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('invalid_target_value')
    })

    it('rejects negative targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: -5,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('invalid_target_value')
    })

    it('rejects NaN targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: NaN,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('invalid_target_value')
    })

    it('rejects Infinity targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: Infinity,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('invalid_target_value')
    })

    it('accepts name at exactly 200 characters', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        name: 'A'.repeat(200),
      })
      expect(result.isOk()).toBe(true)
    })

    it('rejects name at 201 characters', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        name: 'A'.repeat(201),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('name_too_long')
    })

    it('accepts description at exactly 1000 characters', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        description: 'D'.repeat(1000),
      })
      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().description).toBe('D'.repeat(1000))
    })

    it('rejects description over 1000 characters', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        description: 'D'.repeat(1001),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().code).toBe('description_too_long')
    })
  })

  // ── Returned goal shape ──────────────────────────────────────────────
  describe('returned goal shape', () => {
    it('sets status to active by default', () => {
      const result = buildGoal({ ...BASE, goalType: 'open' })
      expect(result._unsafeUnwrap().status).toBe('active')
    })

    it('sets completedAt to null', () => {
      const result = buildGoal({ ...BASE, goalType: 'open' })
      expect(result._unsafeUnwrap().completedAt).toBeNull()
    })

    it('sets parentGoalId to null when not provided', () => {
      const result = buildGoal({ ...BASE, goalType: 'open' })
      expect(result._unsafeUnwrap().parentGoalId).toBeNull()
    })

    it('preserves description', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        description: 'A test goal',
      })
      expect(result._unsafeUnwrap().description).toBe('A test goal')
    })

    it('uses input.now for createdAt and updatedAt', () => {
      const now = new Date('2026-01-15T10:30:00Z')
      const result = buildGoal({ ...BASE, goalType: 'open', now })
      const goal = result._unsafeUnwrap()
      expect(goal.createdAt).toBe(now)
      expect(goal.updatedAt).toBe(now)
    })
  })
})
