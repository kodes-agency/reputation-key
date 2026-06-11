import { describe, it, expect, vi } from 'vitest'
import {
  onPortalGroupDeleted,
  type OnPortalGroupDeletedDeps,
} from './on-portal-group-deleted'
import type { PortalGroupDeleted } from '#/contexts/portal/application/public-api'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import { ok, err } from 'neverthrow'
import {
  organizationId,
  propertyId,
  userId,
  goalId,
  portalGroupId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-06-15T12:00:00Z')

// ── Helpers ──────────────────────────────────────────────────────────

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

function makeEvent(overrides: Partial<PortalGroupDeleted> = {}): PortalGroupDeleted {
  return {
    _tag: 'portal_group.deleted',
    eventId: 'test-event-1',
    correlationId: null,
    portalGroupId: portalGroupId('pg-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    occurredAt: FIXED_TIME,
    ...overrides,
  } as PortalGroupDeleted
}

function makeFakeDeps(storedGoals: Goal[] = []) {
  const cancelledGoalIds: string[] = []

  const goalRepo: GoalRepository = {
    insert: async () => {
      throw new Error('not used')
    },
    getById: async () => null,
    update: async () => null,
    list: async (filter) => {
      return storedGoals.filter((g) => {
        if (g.status !== filter.status) return false
        if (filter.organizationId && g.organizationId !== filter.organizationId)
          return false
        if (filter.portalGroupId && g.portalGroupId !== filter.portalGroupId) return false
        return true
      })
    },
    listInstances: async () => [],
    cancelByParent: async () => 0,
    insertProgress: async () => {
      throw new Error('not used')
    },
    getProgress: async (_gid, _orgId) => null,
    getProgressBatch: async (ids, _orgId) => {
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
    updateProgress: async (_gid, _orgId, _data) => null,
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
    findAllActiveRecurring: async () => [],
    findAllActiveGlobal: async () => [],
    findActiveRecurringTemplates: async () => [],
    findLatestInstance: async () => null,
    createGoalAndProgress: async () => {},
  }

  type CancelGoalFn = OnPortalGroupDeletedDeps['cancelGoalFn']

  const cancelGoalFn: CancelGoalFn = async (input) => {
    cancelledGoalIds.push(input.goalId as string)
    return ok(makeGoal({ id: input.goalId, status: 'cancelled' as const }))
  }
  const cancelGoalFnMock = vi.fn(cancelGoalFn)

  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }

  const deps: OnPortalGroupDeletedDeps = {
    goalRepo,
    cancelGoalFn: cancelGoalFnMock,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getLogger: () => logger as any,
  }

  return { deps, cancelGoalFn: cancelGoalFnMock, cancelledGoalIds, logger }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('onPortalGroupDeleted', () => {
  it('cancels active goals scoped to the deleted portal group', async () => {
    const g1 = makeGoal({
      id: goalId('g-1'),
      portalGroupId: portalGroupId('pg-1'),
      status: 'active',
    })
    const g2 = makeGoal({
      id: goalId('g-2'),
      portalGroupId: portalGroupId('pg-1'),
      status: 'active',
    })

    const fakes = makeFakeDeps([g1, g2])
    const handler = onPortalGroupDeleted(fakes.deps)

    await handler(makeEvent())

    expect(fakes.cancelGoalFn).toHaveBeenCalledTimes(2)
    expect(fakes.cancelledGoalIds).toContain('g-1')
    expect(fakes.cancelledGoalIds).toContain('g-2')
  })

  it('does not cancel goals scoped to other portal groups', async () => {
    const matching = makeGoal({
      id: goalId('g-match'),
      portalGroupId: portalGroupId('pg-1'),
      status: 'active',
    })
    const other = makeGoal({
      id: goalId('g-other'),
      portalGroupId: portalGroupId('pg-999'),
      status: 'active',
    })

    const fakes = makeFakeDeps([matching, other])
    const handler = onPortalGroupDeleted(fakes.deps)

    await handler(makeEvent())

    expect(fakes.cancelGoalFn).toHaveBeenCalledTimes(1)
    expect(fakes.cancelledGoalIds).toContain('g-match')
    expect(fakes.cancelledGoalIds).not.toContain('g-other')
  })

  it('completes silently when no active goals match', async () => {
    const fakes = makeFakeDeps([])
    const handler = onPortalGroupDeleted(fakes.deps)

    await handler(makeEvent())

    expect(fakes.cancelGoalFn).not.toHaveBeenCalled()
  })

  it('logs error but does not throw when cancel fails', async () => {
    const g1 = makeGoal({
      id: goalId('g-fail'),
      portalGroupId: portalGroupId('pg-1'),
      status: 'active',
    })

    const fakes = makeFakeDeps([g1])
    fakes.cancelGoalFn.mockResolvedValueOnce(err({ tag: 'goal_not_found' }))

    const handler = onPortalGroupDeleted(fakes.deps)

    // Should not throw
    await expect(handler(makeEvent())).resolves.toBeUndefined()

    expect(fakes.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: g1.id }),
      'goal: failed to cancel on portal group deleted',
    )
  })

  it('continues cancelling remaining goals when one cancel fails', async () => {
    const g1 = makeGoal({
      id: goalId('g-fail'),
      portalGroupId: portalGroupId('pg-1'),
      status: 'active',
    })
    const g2 = makeGoal({
      id: goalId('g-ok'),
      portalGroupId: portalGroupId('pg-1'),
      status: 'active',
    })

    const fakes = makeFakeDeps([g1, g2])
    // First call fails, second succeeds
    fakes.cancelGoalFn.mockResolvedValueOnce(
      err({ tag: 'goal_not_active', status: 'completed' }),
    )

    const handler = onPortalGroupDeleted(fakes.deps)
    await handler(makeEvent())

    // Both goals were attempted
    expect(fakes.cancelGoalFn).toHaveBeenCalledTimes(2)
    // Error was logged for the failed one
    expect(fakes.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: g1.id }),
      'goal: failed to cancel on portal group deleted',
    )
    // Second goal was still cancelled
    expect(fakes.cancelledGoalIds).toContain('g-ok')
  })

  it('logs error and returns when repository throws', async () => {
    const throwingRepo = {
      ...makeFakeDeps().deps.goalRepo,
      list: async () => {
        throw new Error('DB down')
      },
    }
    const handler = onPortalGroupDeleted({
      ...makeFakeDeps().deps,
      goalRepo: throwingRepo,
    })

    // Should NOT throw
    await expect(handler(makeEvent())).resolves.toBeUndefined()
  })

  it('logs error when cancelGoalFn throws (not returns Err)', async () => {
    const throwingCancel = async () => {
      throw new Error('cancel exploded')
    }
    const g1 = makeGoal({
      id: goalId('g-1'),
      portalGroupId: portalGroupId('pg-1'),
      status: 'active',
    })

    const fakes = makeFakeDeps([g1])
    const handler = onPortalGroupDeleted({ ...fakes.deps, cancelGoalFn: throwingCancel })

    // Should NOT throw
    await expect(handler(makeEvent())).resolves.toBeUndefined()
    expect(fakes.logger.error).toHaveBeenCalled()
  })
})
