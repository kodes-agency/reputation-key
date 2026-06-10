import { describe, it, expect } from 'vitest'
import { updateGoal, type UpdateGoalDeps } from './update-goal'
import type { Goal } from '../../domain/types'
import type { GoalRepository } from '../ports/goal.repository'
import {
  organizationId,
  propertyId,
  goalId,
  goalProgressId,
  userId,
} from '#/shared/domain/ids'
import type { RecurrenceRule } from '../../domain/types'

const FIXED_TIME = new Date('2026-06-15T12:00:00Z')

// ── Fake repo ───────────────────────────────────────────────────────────

function createFakeDeps(overrides?: { storedGoals?: Goal[] }) {
  const stored: Map<string, Goal> = new Map()
  const updatedEntries: Array<{ id: string; data: unknown }> = []
  let idCounter = 0

  const nextId = () => {
    idCounter++
    return `id-${idCounter}`
  }

  if (overrides?.storedGoals) {
    for (const g of overrides.storedGoals) {
      stored.set(g.id as string, g)
    }
  }

  const goalRepo: GoalRepository = {
    insert: async (data) => {
      const goal: Goal = {
        id: goalId(nextId()),
        organizationId: data.organizationId,
        propertyId: data.propertyId,
        portalId: data.portalId,
        portalGroupId: data.portalGroupId,
        name: data.name,
        description: data.description,
        createdBy: data.createdBy,
        goalType: data.goalType,
        aggregationFunction: data.aggregationFunction,
        metricKey: data.metricKey,
        targetValue: data.targetValue,
        status: data.status,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        recurrenceRule: data.recurrenceRule,
        rollingWindowDays: data.rollingWindowDays,
        parentGoalId: data.parentGoalId,
        completedAt: data.completedAt,
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
      }
      stored.set(goal.id as string, goal)
      return goal
    },
    getById: async (id, _orgId) => stored.get(id as string) ?? null,
    update: async (id, _orgId, data) => {
      updatedEntries.push({ id: id as string, data })
      const existing = stored.get(id as string)
      if (!existing) return null
      const updated: Goal = { ...existing, ...data }
      stored.set(id as string, updated)
      return updated
    },
    list: async () => [],
    listInstances: async () => [],
    cancelByParent: async () => 0,
    insertProgress: async (data) => ({
      id: goalProgressId('p-1'),
      goalId: data.goalId,
      currentValue: data.currentValue,
      currentSum: data.currentSum,
      currentCount: data.currentCount,
      lastComputedAt: data.lastComputedAt,
      computedSource: data.computedSource,
    }),
    getProgress: async () => null,
    getProgressBatch: async (ids) => {
      const map = new Map()
      for (const id of ids) {
        map.set(id, null)
      }
      return map
    },
    listInstancesBatch: async (parentIds) => {
      const map = new Map()
      for (const pid of parentIds) {
        map.set(pid, [])
      }
      return map
    },
    updateProgress: async () => null,
    findActiveGoalsByMetric: async () => [],
    upsertProgress: async () => ({
      currentValue: 0,
      currentSum: null,
      currentCount: null,
    }),
    incrementProgress: async () => ({
      currentValue: 0,
      currentSum: null,
      currentCount: null,
    }),
    markGoalCompleted: async () => {},
    findAllActive: async () => [],
    findActiveRecurringTemplates: async () => [],
    findLatestInstance: async () => null,
    createGoalAndProgress: async () => {},
  }

  const deps: UpdateGoalDeps = {
    goalRepo,
    clock: () => FIXED_TIME,
  }

  return { deps, stored, updatedEntries }
}

const makeGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: goalId('goal-1'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('prop-1'),
  portalId: null,
  portalGroupId: null,
  name: 'Get 200 scans',
  description: null,
  createdBy: userId('user-1'),
  goalType: 'open',
  aggregationFunction: 'sum',
  metricKey: 'portal.scan',
  targetValue: 200,
  status: 'active',
  periodStart: null,
  periodEnd: null,
  recurrenceRule: null,
  rollingWindowDays: null,
  parentGoalId: null,
  completedAt: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  ...overrides,
})

describe('updateGoal', () => {
  // ── Permission guard ─────────────────────────────────────────────────
  describe('permission guard', () => {
    it('returns forbidden when Staff tries to update a goal', async () => {
      const goal = makeGoal()
      const fakes = createFakeDeps({ storedGoals: [goal] })

      const result = await updateGoal(fakes.deps)({
        goalId: goalId('goal-1'),
        organizationId: organizationId('org-1'),
        role: 'Staff',
        targetValue: 300,
      })

      expect(result.isErr()).toBe(true)
      const error = result._unsafeUnwrapErr()
      expect(error.tag).toBe('forbidden')
      expect(fakes.updatedEntries).toHaveLength(0)
    })

    it('allows AccountAdmin to update a goal', async () => {
      const goal = makeGoal()
      const fakes = createFakeDeps({ storedGoals: [goal] })

      const result = await updateGoal(fakes.deps)({
        goalId: goalId('goal-1'),
        organizationId: organizationId('org-1'),
        role: 'AccountAdmin',
        targetValue: 300,
      })

      expect(result.isOk()).toBe(true)
    })

    it('allows PropertyManager to update a goal', async () => {
      const goal = makeGoal()
      const fakes = createFakeDeps({ storedGoals: [goal] })

      const result = await updateGoal(fakes.deps)({
        goalId: goalId('goal-1'),
        organizationId: organizationId('org-1'),
        role: 'PropertyManager',
        targetValue: 300,
      })

      expect(result.isOk()).toBe(true)
    })
  })

  it('updates targetValue on an active goal', async () => {
    const goal = makeGoal()
    const fakes = createFakeDeps({ storedGoals: [goal] })

    const result = await updateGoal(fakes.deps)({
      goalId: goalId('goal-1'),
      organizationId: organizationId('org-1'),
      role: 'AccountAdmin',
      targetValue: 300,
    })

    expect(result.isOk()).toBe(true)
    const updated = result._unsafeUnwrap()
    expect(updated.targetValue).toBe(300)
    expect(updated.updatedAt).toEqual(FIXED_TIME)
  })

  it('updates recurrenceRule on a recurring template', async () => {
    const goal = makeGoal({
      goalType: 'recurring',
      recurrenceRule: { frequency: 'monthly' },
    })
    const fakes = createFakeDeps({ storedGoals: [goal] })

    const newRule: RecurrenceRule = { frequency: 'weekly' }
    const result = await updateGoal(fakes.deps)({
      goalId: goalId('goal-1'),
      organizationId: organizationId('org-1'),
      role: 'AccountAdmin',
      recurrenceRule: newRule,
    })

    expect(result.isOk()).toBe(true)
    const updated = result._unsafeUnwrap()
    expect(updated.recurrenceRule).toEqual({ frequency: 'weekly' })
  })

  it('rejects recurrenceRule update on non-recurring goal', async () => {
    const goal = makeGoal({ goalType: 'open' })
    const fakes = createFakeDeps({ storedGoals: [goal] })

    const result = await updateGoal(fakes.deps)({
      goalId: goalId('goal-1'),
      organizationId: organizationId('org-1'),
      role: 'AccountAdmin',
      recurrenceRule: { frequency: 'monthly' },
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.tag).toBe('recurrence_rule_not_allowed')
  })

  it('returns err when updating a cancelled goal', async () => {
    const goal = makeGoal({ status: 'cancelled' })
    const fakes = createFakeDeps({ storedGoals: [goal] })

    const result = await updateGoal(fakes.deps)({
      goalId: goalId('goal-1'),
      organizationId: organizationId('org-1'),
      role: 'AccountAdmin',
      targetValue: 300,
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.tag).toBe('goal_not_active')
  })

  it('returns err when updating a completed goal', async () => {
    const goal = makeGoal({ status: 'completed' })
    const fakes = createFakeDeps({ storedGoals: [goal] })

    const result = await updateGoal(fakes.deps)({
      goalId: goalId('goal-1'),
      organizationId: organizationId('org-1'),
      role: 'AccountAdmin',
      targetValue: 300,
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.tag).toBe('goal_not_active')
  })

  it('returns err when goal is not found', async () => {
    const fakes = createFakeDeps()

    const result = await updateGoal(fakes.deps)({
      goalId: goalId('nonexistent'),
      organizationId: organizationId('org-1'),
      role: 'AccountAdmin',
      targetValue: 300,
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.tag).toBe('goal_not_found')
  })
})
