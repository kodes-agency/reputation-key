import { describe, it, expect } from 'vitest'
import type { Job } from 'bullmq'
import {
  createReconcileGoalProgressHandler,
  type ReconcileGoalProgressDeps,
} from './reconcile-goal-progress.job'
import type { Goal, GoalProgress, GoalStatus } from '../../domain/types'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type {
  MetricReadingsAggregate,
  MetricPublicApi,
} from '#/contexts/metric/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  propertyId,
  goalId,
  goalProgressId,
  userId,
} from '#/shared/domain/ids'
import type { AggregationFunction } from '#/shared/domain/metric-keys'

// ── Fixtures ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-15T12:00:00Z')

function makeGoal(overrides: Partial<Goal> & { goalType: Goal['goalType'] }): Goal {
  return {
    id: goalId('goal-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    portalId: null,
    portalGroupId: null,
    name: 'Test goal',
    description: null,
    createdBy: userId('user-1'),
    aggregationFunction: 'sum' as AggregationFunction,
    metricKey: 'portal.scan',
    targetValue: 100,
    status: 'active',
    periodStart: null,
    periodEnd: null,
    recurrenceRule: null,
    rollingWindowDays: null,
    parentGoalId: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeProgress(overrides: Partial<GoalProgress> = {}): GoalProgress {
  return {
    id: goalProgressId('progress-1'),
    goalId: goalId('goal-1'),
    currentValue: 0,
    currentSum: null,
    currentCount: null,
    lastComputedAt: NOW,
    computedSource: 'event_increment',
    ...overrides,
  }
}

// ── Fake deps ─────────────────────────────────────────────────────────────

function createFakeDeps() {
  const goals: Goal[] = []
  const progresses: Map<string, GoalProgress> = new Map()
  const statusUpdates: Array<{
    id: string
    status: GoalStatus
    completedAt?: Date | null
  }> = []
  let aggregateResponse: MetricReadingsAggregate = { sum: 0, count: 0, max: 0 }

  const goalRepo: GoalRepository = {
    insert: async () => {
      throw new Error('not used')
    },
    getById: async () => null,
    update: async (id, _orgId, data) => {
      const goal = goals.find((g) => g.id === id)
      if (goal) {
        if (data.status) {
          statusUpdates.push({
            id: id as string,
            status: data.status,
            completedAt: data.completedAt,
          })
        }
      }
      return goal ?? null
    },
    list: async () => [],
    listInstances: async () => [],
    cancelByParent: async () => 0,
    findAllActive: async () => goals.filter((g) => g.status === 'active'),
    findActiveRecurringTemplates: async () =>
      goals.filter(
        (g) => g.status === 'active' && g.goalType === 'recurring' && !g.parentGoalId,
      ),
    findLatestInstance: async () => null,
    createGoalAndProgress: async () => {},
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
    insertProgress: async (data) => {
      const p: GoalProgress = {
        id: goalProgressId('new'),
        goalId: data.goalId,
        currentValue: data.currentValue,
        currentSum: data.currentSum,
        currentCount: data.currentCount,
        lastComputedAt: data.lastComputedAt,
        computedSource: data.computedSource,
      }
      progresses.set(data.goalId as string, p)
      return p
    },
    getProgress: async (goalId) => progresses.get(goalId as string) ?? null,
    getProgressBatch: async (ids) => {
      const map = new Map()
      for (const id of ids) {
        map.set(id, progresses.get(id as string) ?? null)
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
    updateProgress: async (goalId, data) => {
      const existing = progresses.get(goalId as string)
      if (!existing) return null
      const updated: GoalProgress = { ...existing, ...data }
      progresses.set(goalId as string, updated)
      return updated
    },
  }

  const metricApi: MetricPublicApi = {
    queryAggregate: async () => aggregateResponse,
  }

  const events: EventBus = {
    on: () => {},
    emit: async () => {},
    clear: () => {},
  }

  const _setAggregate = (agg: MetricReadingsAggregate) => {
    aggregateResponse = agg
  }

  const deps: ReconcileGoalProgressDeps = {
    goalRepo,
    metricApi: metricApi,
    events,
    clock: () => NOW,
  }

  return { deps, goals, progresses, statusUpdates, _setAggregate }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('reconcile-goal-progress job', () => {
  let fakes: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    fakes = createFakeDeps()
  })

  // ── Progress reconciliation ───────────────────────────────────────────

  describe('progress reconciliation', () => {
    it('updates progress when computed value differs from stored', async () => {
      const goal = makeGoal({ goalType: 'open' })
      fakes.goals.push(goal)
      fakes.progresses.set(
        goal.id as string,
        makeProgress({ goalId: goal.id, currentValue: 0 }),
      )

      // Metric repo says there are 75 scans
      fakes._setAggregate({ sum: 75, count: 75, max: 1 })

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      expect(summary.updated).toBe(1)
      expect(summary.goalsReconciled).toBe(1)

      const progress = fakes.progresses.get(goal.id as string)!
      expect(progress.currentValue).toBe(75)
      expect(progress.computedSource).toBe('reconciliation')
    })

    it('does not update progress when value matches', async () => {
      const goal = makeGoal({ goalType: 'open' })
      fakes.goals.push(goal)
      fakes.progresses.set(
        goal.id as string,
        makeProgress({ goalId: goal.id, currentValue: 50 }),
      )

      fakes._setAggregate({ sum: 50, count: 50, max: 1 })

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      expect(summary.updated).toBe(0)
    })
  })

  // ── One-shot expiry ──────────────────────────────────────────────────

  describe('expiry', () => {
    it('marks one-shot goal expired when periodEnd is in the past', async () => {
      const goal = makeGoal({
        goalType: 'one_shot',
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-05-31T23:59:59Z'), // Past
      })
      fakes.goals.push(goal)
      fakes.progresses.set(
        goal.id as string,
        makeProgress({ goalId: goal.id, currentValue: 10 }),
      )

      fakes._setAggregate({ sum: 10, count: 10, max: 1 })

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      expect(summary.expired).toBe(1)
      expect(fakes.statusUpdates).toEqual([
        expect.objectContaining({ status: 'expired' }),
      ])
    })

    it('does not expire one-shot goal whose period has not ended', async () => {
      const goal = makeGoal({
        goalType: 'one_shot',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30T23:59:59Z'), // Still in future
      })
      fakes.goals.push(goal)
      fakes.progresses.set(
        goal.id as string,
        makeProgress({ goalId: goal.id, currentValue: 10 }),
      )

      fakes._setAggregate({ sum: 10, count: 10, max: 1 })

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      expect(summary.expired).toBe(0)
      expect(summary.completed).toBe(0)
    })
  })

  // ── AVG period-end completion ─────────────────────────────────────────

  describe('AVG period-end completion', () => {
    it('marks AVG one-shot goal completed when value >= target and period ended', async () => {
      const goal = makeGoal({
        goalType: 'one_shot',
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        targetValue: 4.0,
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-05-31T23:59:59Z'), // Past
      })
      fakes.goals.push(goal)
      fakes.progresses.set(
        goal.id as string,
        makeProgress({ goalId: goal.id, currentValue: 3.5 }),
      )

      // AVG = 20/4 = 5.0 which is >= 4.0 target
      fakes._setAggregate({ sum: 20, count: 4, max: 5 })

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      expect(summary.completed).toBe(1)
      expect(fakes.statusUpdates).toEqual([
        expect.objectContaining({
          status: 'completed',
          completedAt: NOW,
        }),
      ])
    })

    it('marks AVG recurring instance completed when value >= target and period ended', async () => {
      const goal = makeGoal({
        goalType: 'recurring',
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        targetValue: 3.5,
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-05-31T23:59:59Z'), // Past
        parentGoalId: goalId('template-1'),
        recurrenceRule: { frequency: 'monthly' },
      })
      fakes.goals.push(goal)
      fakes.progresses.set(
        goal.id as string,
        makeProgress({ goalId: goal.id, currentValue: 3.0 }),
      )

      // AVG = 14/4 = 3.5 which is >= 3.5 target
      fakes._setAggregate({ sum: 14, count: 4, max: 5 })

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      expect(summary.completed).toBe(1)
    })

    it('expires AVG goal when value < target and period ended', async () => {
      const goal = makeGoal({
        goalType: 'one_shot',
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        targetValue: 4.0,
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-05-31T23:59:59Z'),
      })
      fakes.goals.push(goal)
      fakes.progresses.set(
        goal.id as string,
        makeProgress({ goalId: goal.id, currentValue: 2.0 }),
      )

      // AVG = 6/3 = 2.0 which is < 4.0 target
      fakes._setAggregate({ sum: 6, count: 3, max: 3 })

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      expect(summary.completed).toBe(0)
      expect(summary.expired).toBe(1)
    })
  })

  // ── Rolling window slide ─────────────────────────────────────────────

  describe('rolling window', () => {
    it('recomputes progress for rolling goal using sliding window', async () => {
      const goal = makeGoal({
        goalType: 'rolling',
        rollingWindowDays: 7,
      })
      fakes.goals.push(goal)
      fakes.progresses.set(
        goal.id as string,
        makeProgress({ goalId: goal.id, currentValue: 100 }), // Stale value
      )

      // Metric repo returns current aggregate (only last 7 days)
      fakes._setAggregate({ sum: 42, count: 42, max: 1 })

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      expect(summary.updated).toBe(1)

      const progress = fakes.progresses.get(goal.id as string)!
      expect(progress.currentValue).toBe(42)
      expect(progress.computedSource).toBe('reconciliation')
    })
  })

  // ── Recurring template skip ──────────────────────────────────────────

  describe('recurring templates', () => {
    it('skips recurring templates (no period)', async () => {
      const template = makeGoal({
        goalType: 'recurring',
        recurrenceRule: { frequency: 'monthly' },
        // No periodStart/periodEnd — it's a template
      })
      fakes.goals.push(template)

      const handler = createReconcileGoalProgressHandler(fakes.deps)
      const summary = await handler({} as Job)

      // No progress to update, no expiry — just skipped
      expect(summary.updated).toBe(0)
      expect(summary.expired).toBe(0)
      expect(summary.completed).toBe(0)
    })
  })
})
