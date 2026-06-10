import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { GoalProgressId } from '#/shared/domain/ids'
import { onMetricRecorded, type OnMetricRecordedDeps } from './on-metric-recorded'
import type { MetricRecorded } from '#/contexts/metric/application/public-api'
import type { GoalCompleted, GoalProgressUpdated } from '../../domain/events'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import {
  organizationId,
  propertyId,
  portalId,
  userId,
  goalId,
  metricReadingId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-06-15T12:00:00Z')

// ── Helpers ──────────────────────────────────────────────────────────

type EmittedEvent = GoalCompleted | GoalProgressUpdated

function makeGoal(overrides: Partial<Goal> & { id: Goal['id'] }): Goal {
  return {
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    portalId: null,
    portalGroupId: null,
    name: 'Test goal',
    description: null,
    createdBy: userId('user-1'),
    goalType: 'open',
    aggregationFunction: 'sum',
    metricKey: 'portal.scan',
    targetValue: 100,
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
  }
}

/** Mutable version of GoalProgress for fake repo mutation. */
type MutableProgress = {
  -readonly [K in keyof GoalProgress]: GoalProgress[K]
}

function makeFakeDeps() {
  const goals: Goal[] = []
  const progresses: Map<string, MutableProgress> = new Map()
  const emittedEvents: EmittedEvent[] = []

  let progressCounter = 0

  const goalRepo: GoalRepository = {
    insert: async () => {
      throw new Error('not used')
    },
    getById: async () => null,
    update: async () => null,
    list: async () => [],
    listInstances: async () => [],
    cancelByParent: async () => 0,
    upsertProgress: async (goalId, _orgId, aggregation, delta) => {
      let p = progresses.get(goalId as string)
      if (!p) {
        // Auto-create progress row for newly created goals
        p = {
          id: `progress-${++progressCounter}` as unknown as GoalProgressId,
          goalId: goalId,
          currentValue: 0,
          currentSum: null,
          currentCount: null,
          lastComputedAt: new Date(),
          computedSource: 'event_increment',
        }
        progresses.set(goalId as string, p)
      }

      if (aggregation === 'sum' || aggregation === 'count') {
        const inc = aggregation === 'count' ? 1 : delta
        p.currentValue += inc
      } else if (aggregation === 'max') {
        p.currentValue = Math.max(p.currentValue, delta)
      } else if (aggregation === 'avg') {
        p.currentSum = (p.currentSum ?? 0) + delta
        p.currentCount = (p.currentCount ?? 0) + 1
        p.currentValue = p.currentCount > 0 ? p.currentSum! / p.currentCount! : 0
      }

      return {
        currentValue: p.currentValue,
        currentSum: p.currentSum,
        currentCount: p.currentCount,
      }
    },
    incrementProgress: async () => {
      throw new Error('not used — use upsertProgress instead')
    },
    insertProgress: async (data) => {
      const p: MutableProgress = {
        id: `progress-${++progressCounter}` as unknown as GoalProgressId,
        goalId: data.goalId,
        currentValue: data.currentValue,
        currentSum: data.currentSum,
        currentCount: data.currentCount,
        lastComputedAt: data.lastComputedAt,
        computedSource: data.computedSource,
      }
      progresses.set(data.goalId as string, p)
      return p as unknown as GoalProgress
    },
    getProgress: async (goalId) => {
      const p = progresses.get(goalId as string)
      return p ? { ...p } : null
    },
    getProgressBatch: async (ids) => {
      const map = new Map()
      for (const id of ids) {
        const p = progresses.get(id as string)
        map.set(id, p ? { ...p } : null)
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

    findActiveGoalsByMetric: async (metricKey, organizationId, propertyId, portalId, portalGroupId) => {
      return goals.filter((g) => {
        if (g.status !== 'active') return false
        if (g.metricKey !== metricKey) return false
        if (g.organizationId !== organizationId) return false
        if (g.propertyId !== propertyId) return false
        // Property-scoped goals always match
        if (g.portalId === null && g.portalGroupId === null) return true
        // Portal-scoped goals match on portalId
        if (portalId && g.portalId === portalId) return true
        // Portal-group-scoped goals match on portalGroupId
        if (portalGroupId && g.portalGroupId === portalGroupId) return true
        return false
      })
    },

    markGoalCompleted: async (goalId, _orgId, completedAt) => {
      const idx = goals.findIndex((g) => g.id === goalId)
      if (idx >= 0) {
        const g = goals[idx]!
        goals[idx] = { ...g, status: 'completed', completedAt }
      }
    },
    findAllActive: async () => [],
    findActiveRecurringTemplates: async () => [],
    findLatestInstance: async (_parentId, _orgId) => null,
    createGoalAndProgress: async () => {},
  }

  const eventBus = {
    emit: async (event: EmittedEvent) => {
      emittedEvents.push(event)
    },
    on: vi.fn(),
    clear: vi.fn(),
  }

  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  }

  const deps: OnMetricRecordedDeps = {
    goalRepo,
    eventBus,
    clock: () => FIXED_TIME,
    findGroupForPortal: async () => null,
    getLogger: () =>
      logger as unknown as OnMetricRecordedDeps['getLogger'] extends () => infer R
        ? R
        : never,
  }

  function addGoalWithProgress(
    goal: Goal,
    progressOverrides: Partial<{
      currentValue: number
      currentSum: number | null
      currentCount: number | null
    }> = {},
  ) {
    goals.push(goal)
    const progress: MutableProgress = {
      id: `progress-${++progressCounter}` as GoalProgressId,
      goalId: goal.id,
      currentValue: progressOverrides.currentValue ?? 0,
      currentSum: progressOverrides.currentSum ?? null,
      currentCount: progressOverrides.currentCount ?? null,
      lastComputedAt: FIXED_TIME,
      computedSource: 'reconciliation',
    }
    progresses.set(goal.id as string, progress)
    return { goal, progress }
  }

  return { deps, emittedEvents, goals, progresses, addGoalWithProgress, logger }
}

function makeEvent(overrides: Partial<MetricRecorded> = {}): MetricRecorded {
  return {
    _tag: 'metric.recorded',
    readingId: metricReadingId('reading-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    portalId: null,
    staffId: null,
    metricKey: 'portal.scan',
    value: 1,
    recordedAt: FIXED_TIME,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('onMetricRecorded', () => {
  let fakes: ReturnType<typeof makeFakeDeps>
  let handler: ReturnType<typeof onMetricRecorded>

  beforeEach(() => {
    fakes = makeFakeDeps()
    handler = onMetricRecorded(fakes.deps)
  })

  // ── SUM goal ───────────────────────────────────────────────────────

  describe('SUM goal', () => {
    it('increments progress by event value', async () => {
      const goal = makeGoal({
        id: goalId('g-sum'),
        aggregationFunction: 'sum',
        metricKey: 'portal.scan',
        targetValue: 100,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 50 })

      await handler(makeEvent({ value: 10 }))

      const progress = fakes.progresses.get('g-sum')!
      expect(progress.currentValue).toBe(60)
    })

    it('emits GoalProgressUpdated', async () => {
      const goal = makeGoal({
        id: goalId('g-sum'),
        aggregationFunction: 'sum',
        targetValue: 100,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 50 })

      await handler(makeEvent({ value: 10 }))

      const progressEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.progress_updated',
      )
      expect(progressEvents).toHaveLength(1)
      const evt = progressEvents[0] as GoalProgressUpdated
      expect(evt.previousValue).toBe(50)
      expect(evt.currentValue).toBe(60)
      expect(evt.computedSource).toBe('event_increment')
    })

    it('completes goal when target met', async () => {
      const goal = makeGoal({
        id: goalId('g-sum'),
        aggregationFunction: 'sum',
        targetValue: 100,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 95 })

      await handler(makeEvent({ value: 10 }))

      expect(fakes.goals[0]!.status).toBe('completed')
      const completedEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.completed',
      )
      expect(completedEvents).toHaveLength(1)
      const evt = completedEvents[0] as GoalCompleted
      expect(evt.completedValue).toBe(105)
      expect(evt.targetValue).toBe(100)
    })

    it('does not complete goal when target not met', async () => {
      const goal = makeGoal({
        id: goalId('g-sum'),
        aggregationFunction: 'sum',
        targetValue: 100,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 50 })

      await handler(makeEvent({ value: 10 }))

      expect(fakes.goals[0]!.status).toBe('active')
      const completedEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.completed',
      )
      expect(completedEvents).toHaveLength(0)
    })
  })

  // ── COUNT goal ─────────────────────────────────────────────────────

  describe('COUNT goal', () => {
    it('increments progress by 1 regardless of event value', async () => {
      const goal = makeGoal({
        id: goalId('g-count'),
        aggregationFunction: 'count',
        metricKey: 'portal.scan',
        targetValue: 10,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 5 })

      await handler(makeEvent({ value: 999 }))

      const progress = fakes.progresses.get('g-count')!
      expect(progress.currentValue).toBe(6)
    })

    it('completes when count reaches target', async () => {
      const goal = makeGoal({
        id: goalId('g-count'),
        aggregationFunction: 'count',
        targetValue: 10,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 9 })

      await handler(makeEvent({ value: 1 }))

      const completedEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.completed',
      )
      expect(completedEvents).toHaveLength(1)
      expect(fakes.goals[0]!.status).toBe('completed')
    })
  })

  // ── MAX goal ───────────────────────────────────────────────────────

  describe('MAX goal', () => {
    it('only increases, never decreases', async () => {
      const goal = makeGoal({
        id: goalId('g-max'),
        aggregationFunction: 'max',
        metricKey: 'portal.rating',
        targetValue: 5,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 4 })

      await handler(makeEvent({ value: 3, metricKey: 'portal.rating' }))

      const progress = fakes.progresses.get('g-max')!
      expect(progress.currentValue).toBe(4) // 4 > 3, stays at 4
    })

    it('updates when new value is higher', async () => {
      const goal = makeGoal({
        id: goalId('g-max'),
        aggregationFunction: 'max',
        metricKey: 'portal.rating',
        targetValue: 5,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 3 })

      await handler(makeEvent({ value: 5, metricKey: 'portal.rating' }))

      const progress = fakes.progresses.get('g-max')!
      expect(progress.currentValue).toBe(5)
    })

    it('completes when max reaches target', async () => {
      const goal = makeGoal({
        id: goalId('g-max'),
        aggregationFunction: 'max',
        metricKey: 'portal.rating',
        targetValue: 5,
      })
      fakes.addGoalWithProgress(goal, { currentValue: 4 })

      await handler(makeEvent({ value: 5, metricKey: 'portal.rating' }))

      expect(fakes.goals[0]!.status).toBe('completed')
      const completedEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.completed',
      )
      expect(completedEvents).toHaveLength(1)
    })
  })

  // ── AVG goal ───────────────────────────────────────────────────────

  describe('AVG goal', () => {
    it('updates currentSum and currentCount', async () => {
      const goal = makeGoal({
        id: goalId('g-avg'),
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        targetValue: 4.5,
        goalType: 'open',
      })
      fakes.addGoalWithProgress(goal, {
        currentValue: 4,
        currentSum: 8,
        currentCount: 2,
      })

      await handler(makeEvent({ value: 5, metricKey: 'portal.rating' }))

      const progress = fakes.progresses.get('g-avg')!
      expect(progress.currentSum).toBe(13) // 8 + 5
      expect(progress.currentCount).toBe(3) // 2 + 1
      expect(progress.currentValue).toBeCloseTo(13 / 3)
    })

    it('does NOT complete AVG one-shot (deferred to reconciliation)', async () => {
      const goal = makeGoal({
        id: goalId('g-avg-os'),
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        targetValue: 3,
        goalType: 'one_shot',
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      fakes.addGoalWithProgress(goal, {
        currentValue: 2,
        currentSum: 4,
        currentCount: 2,
      })

      await handler(makeEvent({ value: 5, metricKey: 'portal.rating' }))

      // AVG is now 9/3 = 3, which meets target, but one_shot defers
      const progress = fakes.progresses.get('g-avg-os')!
      expect(progress.currentValue).toBe(3)

      expect(fakes.goals[0]!.status).toBe('active')
      const completedEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.completed',
      )
      expect(completedEvents).toHaveLength(0)
    })

    it('does NOT complete AVG recurring instance (deferred to reconciliation)', async () => {
      const goal = makeGoal({
        id: goalId('g-avg-rec'),
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        targetValue: 3,
        goalType: 'recurring',
        parentGoalId: goalId('parent-1'),
        periodStart: new Date('2026-06-01'),
        periodEnd: new Date('2026-06-30'),
      })
      fakes.addGoalWithProgress(goal, {
        currentValue: 2,
        currentSum: 4,
        currentCount: 2,
      })

      await handler(makeEvent({ value: 5, metricKey: 'portal.rating' }))

      expect(fakes.goals[0]!.status).toBe('active')
      const completedEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.completed',
      )
      expect(completedEvents).toHaveLength(0)
    })

    it('completes AVG open goal immediately when target met', async () => {
      const goal = makeGoal({
        id: goalId('g-avg-open'),
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        targetValue: 4,
        goalType: 'open',
      })
      fakes.addGoalWithProgress(goal, {
        currentValue: 3.5,
        currentSum: 7,
        currentCount: 2,
      })

      await handler(makeEvent({ value: 5, metricKey: 'portal.rating' }))

      // AVG is now 12/3 = 4, which meets target
      expect(fakes.goals[0]!.status).toBe('completed')
      const completedEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.completed',
      )
      expect(completedEvents).toHaveLength(1)
    })

    it('completes AVG rolling goal immediately when target met', async () => {
      const goal = makeGoal({
        id: goalId('g-avg-roll'),
        aggregationFunction: 'avg',
        metricKey: 'portal.rating',
        targetValue: 4,
        goalType: 'rolling',
        rollingWindowDays: 30,
      })
      fakes.addGoalWithProgress(goal, {
        currentValue: 3.5,
        currentSum: 7,
        currentCount: 2,
      })

      await handler(makeEvent({ value: 5, metricKey: 'portal.rating' }))

      expect(fakes.goals[0]!.status).toBe('completed')
    })
  })

  // ── No matching goals ──────────────────────────────────────────────

  describe('no matching goals', () => {
    it('completes silently when no goals match metric', async () => {
      await handler(makeEvent({ metricKey: 'portal.feedback', value: 5 }))

      expect(fakes.emittedEvents).toHaveLength(0)
    })

    it('completes silently when no goals match org', async () => {
      await handler(makeEvent({ organizationId: organizationId('other-org') }))

      expect(fakes.emittedEvents).toHaveLength(0)
    })
  })

  // ── Portal-scoped matching ─────────────────────────────────────────

  describe('portal-scoped matching', () => {
    it('event with portalId matches portal-scoped goal', async () => {
      const goal = makeGoal({
        id: goalId('g-portal'),
        portalId: portalId('portal-1'),
        metricKey: 'portal.scan',
      })
      fakes.addGoalWithProgress(goal, { currentValue: 0 })

      await handler(
        makeEvent({
          portalId: portalId('portal-1'),
          metricKey: 'portal.scan',
        }),
      )

      const progress = fakes.progresses.get('g-portal')!
      expect(progress.currentValue).toBe(1)
    })

    it('event with portalId also matches property-scoped goal', async () => {
      const propertyGoal = makeGoal({
        id: goalId('g-property'),
        portalId: null,
        metricKey: 'portal.scan',
      })
      const portalGoal = makeGoal({
        id: goalId('g-portal'),
        portalId: portalId('portal-1'),
        metricKey: 'portal.scan',
      })
      fakes.addGoalWithProgress(propertyGoal, { currentValue: 0 })
      fakes.addGoalWithProgress(portalGoal, { currentValue: 0 })

      await handler(
        makeEvent({
          portalId: portalId('portal-1'),
          metricKey: 'portal.scan',
        }),
      )

      const pProp = fakes.progresses.get('g-property')!
      const pPortal = fakes.progresses.get('g-portal')!
      expect(pProp.currentValue).toBe(1)
      expect(pPortal.currentValue).toBe(1)

      // Two progress_updated events
      const progressEvents = fakes.emittedEvents.filter(
        (e) => e._tag === 'goal.progress_updated',
      )
      expect(progressEvents).toHaveLength(2)
    })

    it('event without portalId does NOT match portal-scoped goal', async () => {
      const goal = makeGoal({
        id: goalId('g-portal'),
        portalId: portalId('portal-1'),
        metricKey: 'portal.scan',
      })
      fakes.addGoalWithProgress(goal, { currentValue: 0 })

      await handler(makeEvent({ portalId: null, metricKey: 'portal.scan' }))

      expect(fakes.emittedEvents).toHaveLength(0)
    })
  })

  // ── Outer query error ──────────────────────────────────────────────

  describe('outer query error handling', () => {
    it('logs error and returns when findActiveGoalsByMetric throws', async () => {
      const throwingRepo = {
        ...fakes.deps.goalRepo,
        findActiveGoalsByMetric: async () => {
          throw new Error('DB down')
        },
      }
      const logger = {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }
      const handlerWithThrowingRepo = onMetricRecorded({
        ...fakes.deps,
        goalRepo: throwingRepo,
        getLogger: () =>
          logger as unknown as OnMetricRecordedDeps['getLogger'] extends () => infer R
            ? R
            : never,
      })

      // Should NOT throw
      await expect(handlerWithThrowingRepo(makeEvent())).resolves.toBeUndefined()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('fatal error querying goals'),
      )
    })
  })
})
