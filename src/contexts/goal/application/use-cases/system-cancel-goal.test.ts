import { describe, it, expect, vi } from 'vitest'
import { systemCancelGoal, type SystemCancelGoalDeps } from './system-cancel-goal'
import type { Goal } from '../../domain/types'
import type { GoalRepository } from '../ports/goal.repository'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'
import { organizationId, propertyId, goalId, userId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-06-15T12:00:00Z')

// ── Fake repo ───────────────────────────────────────────────────────────

function createFakeDeps(storedGoals: Goal[] = []) {
  const stored: Map<string, Goal> = new Map()

  for (const g of storedGoals) {
    stored.set(g.id as string, g)
  }

  let cancelTemplateCallCount = 0

  const goalRepo: GoalRepository = {
    insert: async () => {
      throw new Error('not used')
    },
    getById: async (id, _orgId) => stored.get(id as string) ?? null,
    update: async (id, _orgId, data) => {
      const existing = stored.get(id as string)
      if (!existing) return null
      const updated: Goal = { ...existing, ...data }
      stored.set(id as string, updated)
      return updated
    },
    list: async () => [],
    listInstances: async () => [],
    cancelByParent: async () => 0,
    insertProgress: async () => {
      throw new Error('not used')
    },
    getProgress: async () => null,
    getProgressBatch: async (ids) => {
      const map = new Map()
      for (const id of ids) map.set(id, null)
      return map
    },
    listInstancesBatch: async (parentIds) => {
      const map = new Map()
      for (const pid of parentIds) map.set(pid, [])
      return map
    },
    updateProgress: async () => null,
    findActiveGoalsByMetric: async () => [],
    upsertProgress: async () => ({
      currentValue: 0,
      currentSum: null,
      currentCount: null,
    }),
    markGoalCompleted: async () => {},
    findAllActiveRecurring: async () => [],
    findAllActiveGlobal: async () => [],
    findActiveRecurringTemplates: async () => [],
    findLatestInstance: async () => null,
    cancelTemplateAndInstances: async (gid, _orgId, now) => {
      cancelTemplateCallCount++
      const g = stored.get(gid as string)
      if (!g) return null
      const updated: Goal = {
        ...g,
        status: 'cancelled' as const,
        updatedAt: now,
      }
      stored.set(gid as string, updated)
      return updated
    },
    createRecurringGoalWithInstance: async () => {},
    createGoalAndProgress: async () => {},
  }

  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }

  const deps: SystemCancelGoalDeps = {
    goalRepo,
    clock: () => FIXED_TIME,
    getLogger: (() =>
      logger as unknown as ReturnType<typeof getLoggerType>) as typeof getLoggerType,
  }

  return {
    deps,
    stored,
    logger,
    cancelTemplateCallCount: () => cancelTemplateCallCount,
  }
}

const ORG = organizationId('org-1')
const PROP = propertyId('prop-1')

const makeGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: goalId('goal-1'),
  organizationId: ORG,
  propertyId: PROP,
  portalId: null,
  portalGroupId: null,
  name: 'Get 200 scans',
  description: null,
  createdBy: userId('goal-1'),
  goalType: 'one_shot',
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

// ── Tests ───────────────────────────────────────────────────────────────

describe('systemCancelGoal', () => {
  it('cancels an active non-recurring goal via update', async () => {
    const goal = makeGoal()
    const fakes = createFakeDeps([goal])

    const result = await systemCancelGoal(fakes.deps)({
      goalId: goal.id,
      organizationId: ORG,
      reason: 'portal_deleted',
    })

    expect(result.isOk()).toBe(true)
    const cancelled = result._unsafeUnwrap()
    expect(cancelled.status).toBe('cancelled')
    // Non-recurring must NOT call cancelTemplateAndInstances
    expect(fakes.cancelTemplateCallCount()).toBe(0)
  })

  it('cancels a recurring template via cancelTemplateAndInstances', async () => {
    const template = makeGoal({
      id: goalId('tmpl-1'),
      goalType: 'recurring',
      parentGoalId: null,
      recurrenceRule: { frequency: 'monthly' },
    })
    const fakes = createFakeDeps([template])

    const result = await systemCancelGoal(fakes.deps)({
      goalId: template.id,
      organizationId: ORG,
      reason: 'portal_group_deleted',
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('cancelled')
    expect(fakes.cancelTemplateCallCount()).toBe(1)
  })

  it('returns goal_not_found when the goal does not exist', async () => {
    const fakes = createFakeDeps([])

    const result = await systemCancelGoal(fakes.deps)({
      goalId: goalId('missing'),
      organizationId: ORG,
      reason: 'portal_deleted',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toEqual({ tag: 'goal_not_found' })
  })

  it('returns goal_not_active when the goal is already completed', async () => {
    const goal = makeGoal({ status: 'completed' })
    const fakes = createFakeDeps([goal])

    const result = await systemCancelGoal(fakes.deps)({
      goalId: goal.id,
      organizationId: ORG,
      reason: 'portal_deleted',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toEqual({
      tag: 'goal_not_active',
      status: 'completed',
    })
  })

  it('returns goal_not_active when the goal is already cancelled', async () => {
    const goal = makeGoal({ status: 'cancelled' })
    const fakes = createFakeDeps([goal])

    const result = await systemCancelGoal(fakes.deps)({
      goalId: goal.id,
      organizationId: ORG,
      reason: 'portal_group_deleted',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toEqual({
      tag: 'goal_not_active',
      status: 'cancelled',
    })
  })

  it('logs the reason as an audit marker', async () => {
    const goal = makeGoal()
    const fakes = createFakeDeps([goal])

    await systemCancelGoal(fakes.deps)({
      goalId: goal.id,
      organizationId: ORG,
      reason: 'portal_deleted',
    })

    expect(fakes.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: goal.id,
        reason: 'portal_deleted',
        organizationId: ORG,
      }),
      'goal: system-initiated cancellation',
    )
  })

  it('does not check role-based permissions (no can() gate)', async () => {
    // systemCancelGoal has no role/userId in its input — it cannot and
    // must not gate on permissions. A system action succeeds for any active
    // goal regardless of who would have been allowed to cancel it.
    const goal = makeGoal()
    const fakes = createFakeDeps([goal])

    const result = await systemCancelGoal(fakes.deps)({
      goalId: goal.id,
      organizationId: ORG,
      reason: 'portal_deleted',
    })

    expect(result.isOk()).toBe(true)
  })

  it('does not check property accessibility (no self-assignment guard)', async () => {
    // The regular cancelGoal use case rejects callers whose staff assignment
    // does not cover the goal's property. systemCancelGoal intentionally
    // skips that guard — the system is not a staff member.
    const goal = makeGoal({ propertyId: propertyId('any-prop') })
    const fakes = createFakeDeps([goal])

    const result = await systemCancelGoal(fakes.deps)({
      goalId: goal.id,
      organizationId: ORG,
      reason: 'portal_deleted',
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().status).toBe('cancelled')
  })
})
