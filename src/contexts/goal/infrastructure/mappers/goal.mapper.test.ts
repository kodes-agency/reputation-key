// Goal context — goal & goalProgress mapper tests

import { describe, it, expect } from 'vitest'
import { goalFromRow, goalProgressFromRow } from './goal.mapper'
import type { goals, goalProgress } from '#/shared/db/schema/goal.schema'

type GoalRow = typeof goals.$inferSelect
type GoalProgressRow = typeof goalProgress.$inferSelect

const now = new Date('2025-06-01T12:00:00Z')
const periodStart = new Date('2025-06-01T00:00:00Z')
const periodEnd = new Date('2025-06-30T23:59:59Z')

const sampleGoalRow: GoalRow = {
  id: 'goal-uuid-001',
  organizationId: 'org-uuid-001',
  propertyId: 'prop-uuid-001',
  portalId: 'portal-uuid-001',
  portalGroupId: null,
  name: 'Get 50 reviews',
  description: 'Achieve 50 reviews this month',
  createdBy: 'user-uuid-001',
  goalType: 'recurring',
  aggregationFunction: 'sum',
  metricKey: 'portal.scan',
  targetValue: 50,
  status: 'active',
  periodStart,
  periodEnd,
  recurrenceRule: { frequency: 'monthly' },
  rollingWindowDays: null,
  parentGoalId: null,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
}

const sampleProgressRow: GoalProgressRow = {
  id: 'progress-uuid-001',
  goalId: 'goal-uuid-001',
  currentValue: 23,
  currentSum: 230,
  currentCount: 10,
  lastComputedAt: now,
  computedSource: 'event_increment',
}

// ── goalFromRow ──────────────────────────────────────────────────────────

describe('goalFromRow', () => {
  it('brands all IDs correctly', () => {
    const goal = goalFromRow(sampleGoalRow)
    expect(String(goal.id)).toBe('goal-uuid-001')
    expect(String(goal.organizationId)).toBe('org-uuid-001')
    expect(String(goal.propertyId)).toBe('prop-uuid-001')
    expect(String(goal.portalId)).toBe('portal-uuid-001')
    expect(String(goal.createdBy)).toBe('user-uuid-001')
  })

  it('maps all scalar fields', () => {
    const goal = goalFromRow(sampleGoalRow)
    expect(goal.name).toBe('Get 50 reviews')
    expect(goal.description).toBe('Achieve 50 reviews this month')
    expect(goal.goalType).toBe('recurring')
    expect(goal.aggregationFunction).toBe('sum')
    expect(goal.metricKey).toBe('portal.scan')
    expect(goal.targetValue).toBe(50)
    expect(goal.status).toBe('active')
    expect(goal.periodStart).toBe(periodStart)
    expect(goal.periodEnd).toBe(periodEnd)
    expect(goal.rollingWindowDays).toBeNull()
    expect(goal.parentGoalId).toBeNull()
    expect(goal.completedAt).toBeNull()
    expect(goal.createdAt).toBe(now)
    expect(goal.updatedAt).toBe(now)
  })

  it('parses recurrenceRule correctly', () => {
    const goal = goalFromRow(sampleGoalRow)
    expect(goal.recurrenceRule).toEqual({ frequency: 'monthly' })
  })

  it('handles null recurrenceRule', () => {
    const row = { ...sampleGoalRow, recurrenceRule: null, goalType: 'one_shot' as const }
    const goal = goalFromRow(row)
    expect(goal.recurrenceRule).toBeNull()
  })

  it('handles null optional FK fields', () => {
    const row: GoalRow = {
      ...sampleGoalRow,
      portalId: null,
      portalGroupId: null,
    }
    const goal = goalFromRow(row)
    expect(goal.portalId).toBeNull()
    expect(goal.portalGroupId).toBeNull()
  })

  it('brands parentGoalId when present', () => {
    const row = { ...sampleGoalRow, parentGoalId: 'parent-goal-uuid' }
    const goal = goalFromRow(row)
    expect(String(goal.parentGoalId)).toBe('parent-goal-uuid')
  })

  it('throws on invalid goalType', () => {
    const row = { ...sampleGoalRow, goalType: 'invalid' }
    expect(() => goalFromRow(row)).toThrow('Invalid goalType')
  })

  it('throws on invalid status', () => {
    const row = { ...sampleGoalRow, status: 'unknown' }
    expect(() => goalFromRow(row)).toThrow('Invalid status')
  })

  it('throws on invalid aggregationFunction', () => {
    const row = { ...sampleGoalRow, aggregationFunction: 'median' }
    expect(() => goalFromRow(row)).toThrow('Invalid aggregationFunction')
  })

  it('throws on invalid metricKey', () => {
    const row = { ...sampleGoalRow, metricKey: 'invalid.key' }
    expect(() => goalFromRow(row)).toThrow('Invalid metricKey')
  })

  it('validates all valid goalTypes', () => {
    for (const goalType of ['open', 'one_shot', 'rolling', 'recurring'] as const) {
      const row = { ...sampleGoalRow, goalType }
      const goal = goalFromRow(row)
      expect(goal.goalType).toBe(goalType)
    }
  })

  it('validates all valid statuses', () => {
    for (const status of ['active', 'completed', 'expired', 'cancelled'] as const) {
      const row = { ...sampleGoalRow, status }
      const goal = goalFromRow(row)
      expect(goal.status).toBe(status)
    }
  })
})

// ── goalProgressFromRow ──────────────────────────────────────────────────

describe('goalProgressFromRow', () => {
  it('brands IDs correctly', () => {
    const progress = goalProgressFromRow(sampleProgressRow)
    expect(String(progress.id)).toBe('progress-uuid-001')
    expect(String(progress.goalId)).toBe('goal-uuid-001')
  })

  it('maps all fields', () => {
    const progress = goalProgressFromRow(sampleProgressRow)
    expect(progress.currentValue).toBe(23)
    expect(progress.currentSum).toBe(230)
    expect(progress.currentCount).toBe(10)
    expect(progress.lastComputedAt).toBe(now)
    expect(progress.computedSource).toBe('event_increment')
  })

  it('handles null currentSum and currentCount', () => {
    const row: GoalProgressRow = {
      ...sampleProgressRow,
      currentSum: null,
      currentCount: null,
    }
    const progress = goalProgressFromRow(row)
    expect(progress.currentSum).toBeNull()
    expect(progress.currentCount).toBeNull()
  })

  it('accepts reconciliation as computedSource', () => {
    const row = { ...sampleProgressRow, computedSource: 'reconciliation' }
    const progress = goalProgressFromRow(row)
    expect(progress.computedSource).toBe('reconciliation')
  })

  it('throws on invalid computedSource', () => {
    const row = { ...sampleProgressRow, computedSource: 'invalid' }
    expect(() => goalProgressFromRow(row)).toThrow('Invalid computedSource')
  })
})
