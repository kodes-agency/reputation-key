import { describe, it, expect, beforeEach } from 'vitest'
import { createGoal, type CreateGoalDeps } from './create-goal'
import type { Goal, GoalProgress } from '../../domain/types'
import type {
  MetricReadingsQuery,
  MetricReadingsAggregate,
} from '../../../metric/application/public-api'
import type { GoalRepository } from '../ports/goal.repository'
import {
  organizationId,
  propertyId,
  portalId,
  teamId,
  staffId,
  goalId,
  goalProgressId,
  userId,
} from '#/shared/domain/ids'
import type { MetricKey, AggregationFunction } from '#/shared/domain/metric-keys'

const FIXED_TIME = new Date('2026-06-15T12:00:00Z')

// ── Fake repos ──────────────────────────────────────────────────────────

function createFakeDeps() {
  const goals: Goal[] = []
  const progresses: GoalProgress[] = []
  let idCounter = 0

  const nextId = () => {
    idCounter++
    return `id-${idCounter}`
  }

  const goalRepo: GoalRepository = {
    insert: async (data) => {
      const goal: Goal = {
        id: goalId(nextId()),
        organizationId: data.organizationId,
        propertyId: data.propertyId,
        portalId: data.portalId,
        teamId: data.teamId,
        staffId: data.staffId,
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
      goals.push(goal)
      return goal
    },
    getById: async () => null,
    update: async () => null,
    list: async () => [],
    listInstances: async () => [],
    cancelByParent: async () => 0,
    insertProgress: async (data) => {
      const progress: GoalProgress = {
        id: goalProgressId(nextId()),
        goalId: data.goalId,
        currentValue: data.currentValue,
        currentSum: data.currentSum,
        currentCount: data.currentCount,
        lastComputedAt: data.lastComputedAt,
        computedSource: data.computedSource,
      }
      progresses.push(progress)
      return progress
    },
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
    createGoalAndProgress: async (goal, progress) => {
      goals.push(goal)
      progresses.push(progress)
    },
  }

  let aggregateResponse: MetricReadingsAggregate = { sum: 0, count: 0, max: 0 }
  const queries: MetricReadingsQuery[] = []

  const metricRepo = {
    queryAggregate: async (query: MetricReadingsQuery) => {
      queries.push(query)
      return aggregateResponse
    },
    _setAggregate: (agg: MetricReadingsAggregate) => {
      aggregateResponse = agg
    },
    _getQueries: () => queries,
  }

  const deps: CreateGoalDeps = {
    goalRepo,
    metricRepo,
    idGen: () => nextId(),
    clock: () => FIXED_TIME,
  }

  return { deps, goals, progresses, metricRepo }
}

const BASE_INPUT = {
  organizationId: organizationId('org-1'),
  propertyId: propertyId('prop-1'),
  portalId: null as ReturnType<typeof portalId> | null,
  teamId: null as ReturnType<typeof teamId> | null,
  staffId: null as ReturnType<typeof staffId> | null,
  name: 'Get 200 scans',
  description: null as string | null,
  createdBy: userId('user-1'),
  metricKey: 'portal.scan' as MetricKey,
  aggregationFunction: 'sum' as AggregationFunction,
  targetValue: 200,
  role: 'AccountAdmin' as const,
}

describe('createGoal', () => {
  let fakes: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    fakes = createFakeDeps()
  })

  // ── Open goal ────────────────────────────────────────────────────────
  describe('open goal', () => {
    it('creates an open goal at property scope and inserts goal + progress', async () => {
      fakes.metricRepo._setAggregate({ sum: 50, count: 50, max: 1 })

      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
      })

      expect(result.isOk()).toBe(true)
      const { goal, progress } = result._unsafeUnwrap()

      expect(goal.goalType).toBe('open')
      expect(goal.status).toBe('active')
      expect(goal.periodStart).toBeNull()
      expect(goal.periodEnd).toBeNull()
      expect(goal.rollingWindowDays).toBeNull()
      expect(goal.organizationId).toBe(organizationId('org-1'))
      expect(goal.propertyId).toBe(propertyId('prop-1'))

      expect(progress.goalId).toBe(goal.id)
      expect(progress.computedSource).toBe('reconciliation')
      expect(progress.currentValue).toBe(50) // sum from aggregate
      expect(progress.currentSum).toBeNull()
      expect(progress.currentCount).toBeNull()
    })

    it('queries metric repo with no time filter for open goal', async () => {
      await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
      })

      const queries = fakes.metricRepo._getQueries()
      expect(queries).toHaveLength(1)
      expect(queries[0]!.metricKey).toBe('portal.scan')
      expect(queries[0]!.periodStart).toBeUndefined()
      expect(queries[0]!.periodEnd).toBeUndefined()
      expect(queries[0]!.rollingWindowDays).toBeUndefined()
    })
  })

  // ── One-shot goal ────────────────────────────────────────────────────
  describe('one-shot goal', () => {
    it('creates a one-shot goal with period dates', async () => {
      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'one_shot',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })

      expect(result.isOk()).toBe(true)
      const { goal } = result._unsafeUnwrap()

      expect(goal.goalType).toBe('one_shot')
      expect(goal.periodStart).toEqual(new Date('2026-06-01'))
      expect(goal.periodEnd).toEqual(new Date('2026-06-30'))
    })

    it('queries metric repo with period bounds', async () => {
      await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'one_shot',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })

      const queries = fakes.metricRepo._getQueries()
      expect(queries).toHaveLength(1)
      expect(queries[0]!.periodStart).toEqual(new Date('2026-06-01'))
      expect(queries[0]!.periodEnd).toEqual(new Date('2026-06-30'))
    })
  })

  // ── Rolling goal ─────────────────────────────────────────────────────
  describe('rolling goal', () => {
    it('creates a rolling goal with rollingWindowDays', async () => {
      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'rolling',
        rollingWindowDays: 30,
      })

      expect(result.isOk()).toBe(true)
      const { goal } = result._unsafeUnwrap()

      expect(goal.goalType).toBe('rolling')
      expect(goal.rollingWindowDays).toBe(30)
      expect(goal.periodStart).toBeNull()
    })

    it('queries metric repo with rollingWindowDays', async () => {
      await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'rolling',
        rollingWindowDays: 30,
      })

      const queries = fakes.metricRepo._getQueries()
      expect(queries).toHaveLength(1)
      expect(queries[0]!.rollingWindowDays).toBe(30)
    })
  })

  // ── Recurring goal ───────────────────────────────────────────────────
  describe('recurring goal', () => {
    it('creates template + first instance + instance progress', async () => {
      fakes.metricRepo._setAggregate({ sum: 10, count: 5, max: 4 })

      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
      })

      expect(result.isOk()).toBe(true)
      const { goal: template } = result._unsafeUnwrap()

      // Template has no dates
      expect(template.goalType).toBe('recurring')
      expect(template.recurrenceRule).toEqual({ frequency: 'monthly' })
      expect(template.periodStart).toBeNull()
      expect(template.periodEnd).toBeNull()
      expect(template.parentGoalId).toBeNull()

      // First instance is created as a child
      const instances = fakes.goals.filter((g) => g.parentGoalId === template.id)
      expect(instances).toHaveLength(1)

      const instance = instances[0]!
      expect(instance.goalType).toBe('recurring')
      expect(instance.parentGoalId).toBe(template.id)
      // June 2026: monthly anchored to month start
      expect(instance.periodStart).toEqual(new Date('2026-06-01T00:00:00.000Z'))
      expect(instance.periodEnd).toEqual(new Date('2026-06-30T23:59:59.999Z'))

      // Template progress + instance progress
      // Template gets no progress (or zero), instance gets real progress
      const instanceProgresses = fakes.progresses.filter((p) => p.goalId === instance.id)
      expect(instanceProgresses).toHaveLength(1)
      expect(instanceProgresses[0]!.currentValue).toBe(10)
    })

    it('computes weekly calendar period for recurring weekly', async () => {
      // FIXED_TIME is Monday 2026-06-15
      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'weekly' },
      })

      expect(result.isOk()).toBe(true)
      const instances = fakes.goals.filter((g) => g.parentGoalId !== null)
      expect(instances).toHaveLength(1)
      // ISO 8601 week: Monday to Sunday
      expect(instances[0]!.periodStart).toEqual(new Date('2026-06-15T00:00:00.000Z'))
      expect(instances[0]!.periodEnd).toEqual(new Date('2026-06-21T23:59:59.999Z'))
    })

    it('computes quarterly calendar period for recurring quarterly', async () => {
      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'recurring',
        recurrenceRule: { frequency: 'quarterly' },
      })

      expect(result.isOk()).toBe(true)
      const instances = fakes.goals.filter((g) => g.parentGoalId !== null)
      expect(instances).toHaveLength(1)
      // Q2 2026: April 1 to June 30
      expect(instances[0]!.periodStart).toEqual(new Date('2026-04-01T00:00:00.000Z'))
      expect(instances[0]!.periodEnd).toEqual(new Date('2026-06-30T23:59:59.999Z'))
    })
  })

  // ── AVG aggregation ──────────────────────────────────────────────────
  describe('AVG aggregation', () => {
    it('stores currentSum and currentCount for AVG', async () => {
      fakes.metricRepo._setAggregate({ sum: 24, count: 6, max: 5 })

      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
        metricKey: 'portal.rating',
        aggregationFunction: 'avg',
        targetValue: 4.5,
      })

      expect(result.isOk()).toBe(true)
      const { progress } = result._unsafeUnwrap()

      expect(progress.currentValue).toBe(4) // 24 / 6 = 4
      expect(progress.currentSum).toBe(24)
      expect(progress.currentCount).toBe(6)
    })
  })

  // ── Permission guard ─────────────────────────────────────────────────
  describe('permission guard', () => {
    it('allows Staff to create a goal', async () => {
      fakes.metricRepo._setAggregate({ sum: 0, count: 0, max: 0 })

      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
        role: 'Staff',
      })

      expect(result.isOk()).toBe(true)
      expect(fakes.goals).toHaveLength(1)
    })

    it('allows AccountAdmin to create a goal', async () => {
      fakes.metricRepo._setAggregate({ sum: 0, count: 0, max: 0 })

      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
        role: 'AccountAdmin',
      })

      expect(result.isOk()).toBe(true)
    })

    it('allows PropertyManager to create a goal', async () => {
      fakes.metricRepo._setAggregate({ sum: 0, count: 0, max: 0 })

      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
        role: 'PropertyManager',
      })

      expect(result.isOk()).toBe(true)
    })
  })

  // ── Error cases ──────────────────────────────────────────────────────
  describe('validation errors', () => {
    it('returns err for invalid metric/scope combination', async () => {
      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
        staffId: staffId('staff-1'),
        metricKey: 'property.review',
      })

      expect(result.isErr()).toBe(true)
      expect(fakes.goals).toHaveLength(0)
    })

    it('returns err for invalid aggregation/metric combination', async () => {
      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
        metricKey: 'portal.scan',
        aggregationFunction: 'avg',
      })

      expect(result.isErr()).toBe(true)
      expect(fakes.goals).toHaveLength(0)
    })

    it('returns err for empty name', async () => {
      const result = await createGoal(fakes.deps)({
        ...BASE_INPUT,
        goalType: 'open',
        name: '   ',
      })

      expect(result.isErr()).toBe(true)
    })
  })
})
