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

    it('rejects open goal with period dates', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      expect(result.isErr()).toBe(true)
    })

    it('rejects open goal with rollingWindowDays', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        rollingWindowDays: 30,
      })
      expect(result.isErr()).toBe(true)
    })

    it('rejects open goal with recurrenceRule', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        recurrenceRule: { frequency: 'monthly' },
      })
      expect(result.isErr()).toBe(true)
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
    })

    it('rejects one-shot goal with periodEnd before periodStart', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'one_shot',
        periodStart: new Date('2026-06-30'),
        periodEnd: new Date('2026-06-01'),
      })
      expect(result.isErr()).toBe(true)
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
    })

    it('rejects team scope with property.review metric', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        teamId: teamId('team-1'),
        metricKey: 'property.review',
      })
      expect(result.isErr()).toBe(true)
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
    })

    it('rejects zero targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: 0,
      })
      expect(result.isErr()).toBe(true)
    })

    it('rejects negative targetValue', () => {
      const result = buildGoal({
        ...BASE,
        goalType: 'open',
        targetValue: -5,
      })
      expect(result.isErr()).toBe(true)
    })
  })
})
