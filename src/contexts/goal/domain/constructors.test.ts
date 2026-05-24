import { describe, it, expect } from 'vitest'
import { buildGoal } from './constructors'
import {
  organizationId,
  propertyId,
  portalId,
  teamId,
  staffId,
  goalId,
  userId,
} from '#/shared/domain/ids'
import type { GoalType } from './types'

const BASE = {
  id: goalId('goal-1'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('prop-1'),
  portalId: null as ReturnType<typeof portalId> | null,
  teamId: null as ReturnType<typeof teamId> | null,
  staffId: null as ReturnType<typeof staffId> | null,
  name: 'Get 200 scans',
  description: null as string | null,
  createdBy: userId('user-1'),
  metricKey: 'portal.scan' as const,
  aggregationFunction: 'sum' as const,
  targetValue: 200,
  now: new Date('2026-06-01T12:00:00Z'),
}

describe('buildGoal', () => {
  // ── Open goal ────────────────────────────────────────────────────────
  describe('open goal', () => {
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

    it('creates an open goal at portal scope', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        portalId: portalId('portal-1'),
      })
      expect(result.isOk()).toBe(true)
    })

    it('creates an open goal at team scope', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        teamId: teamId('team-1'),
      })
      expect(result.isOk()).toBe(true)
    })

    it('creates an open goal at staff scope', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        staffId: staffId('staff-1'),
      })
      expect(result.isOk()).toBe(true)
    })

    it('rejects open goal with period dates', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('period_not_allowed')
    })

    it('rejects open goal with rollingWindowDays', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        rollingWindowDays: 30,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('rolling_window_not_allowed')
    })

    it('rejects open goal with recurrenceRule', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        recurrenceRule: { frequency: 'monthly' },
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('recurrence_rule_not_allowed')
    })
  })

  // ── One-shot goal ────────────────────────────────────────────────────
  describe('one-shot goal', () => {
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
      expect(result._unsafeUnwrapErr().tag).toBe('period_required')
    })

    it('rejects one-shot goal with periodEnd before periodStart', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'one_shot',
        periodStart: new Date('2026-06-30'),
        periodEnd: new Date('2026-06-01'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_period')
    })

    it('rejects one-shot goal with rollingWindowDays', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'one_shot',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
        rollingWindowDays: 30,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('rolling_window_not_allowed')
    })

    it('rejects one-shot goal with recurrenceRule', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'one_shot',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
        recurrenceRule: { frequency: 'monthly' },
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('recurrence_rule_not_allowed')
    })
  })

  // ── Rolling goal ─────────────────────────────────────────────────────
  describe('rolling goal', () => {
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
      expect(result._unsafeUnwrapErr().tag).toBe('rolling_window_required')
    })

    it('rejects rolling goal with period dates', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'rolling',
        rollingWindowDays: 30,
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('period_not_allowed')
    })

    it('rejects rolling goal with recurrenceRule', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'rolling',
        rollingWindowDays: 30,
        recurrenceRule: { frequency: 'monthly' },
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('recurrence_rule_not_allowed')
    })

    it('rejects rolling goal with rollingWindowDays = 0', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'rolling',
        rollingWindowDays: 0,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('rolling_window_required')
    })

    it('rejects rolling goal with negative rollingWindowDays', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'rolling',
        rollingWindowDays: -5,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('rolling_window_required')
    })
  })

  // ── Recurring goal (template) ────────────────────────────────────────
  describe('recurring goal', () => {
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

    it('rejects recurring without recurrenceRule', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'recurring',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('recurrence_rule_required')
    })

    it('rejects recurring with period dates (template cannot have dates)', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('period_not_allowed')
    })

    it('rejects recurring with rollingWindowDays', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
        rollingWindowDays: 30,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('rolling_window_not_allowed')
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

    it('rejects recurring instance with periodEnd before periodStart', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
        parentGoalId: goalId('parent-1'),
        periodStart: new Date('2026-06-30'),
        periodEnd: new Date('2026-06-01'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_period')
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
    it('rejects staff scope with property.review metric', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        staffId: staffId('staff-1'),
        metricKey: 'property.review',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_metric_for_scope')
    })

    it('rejects team scope with property.review metric', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        teamId: teamId('team-1'),
        metricKey: 'property.review',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_metric_for_scope')
    })

    it('allows staff scope with portal.scan metric', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        staffId: staffId('staff-1'),
        metricKey: 'portal.scan',
      })
      expect(result.isOk()).toBe(true)
    })

    it('rejects when multiple scope FKs are set (ambiguous scope)', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        portalId: portalId('portal-1'),
        teamId: teamId('team-1'),
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('ambiguous_scope')
    })
  })

  // ── Metric key × aggregation validation ─────────────────────────────
  describe('metric × aggregation', () => {
    it('rejects AVG on portal.scan', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        metricKey: 'portal.scan',
        aggregationFunction: 'avg',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_aggregation_for_metric')
    })

    it('allows AVG on portal.rating', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        metricKey: 'portal.rating',
        aggregationFunction: 'avg',
      })
      expect(result.isOk()).toBe(true)
    })

    it('rejects SUM on portal.rating', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        metricKey: 'portal.rating',
        aggregationFunction: 'sum',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_aggregation_for_metric')
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
      expect(result._unsafeUnwrapErr().tag).toBe('empty_name')
    })

    it('rejects whitespace-only name', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        name: '   ',
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('empty_name')
    })

    it('rejects zero targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: 0,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_target_value')
    })

    it('rejects negative targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: -5,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_target_value')
    })

    it('rejects NaN targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: NaN,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_target_value')
    })

    it('rejects Infinity targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: Infinity,
      })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().tag).toBe('invalid_target_value')
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
      expect(result._unsafeUnwrapErr().tag).toBe('name_too_long')
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
      expect(result._unsafeUnwrapErr().tag).toBe('description_too_long')
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
