import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalExecutionPolicy } from '../monthly-goals/goal-programs.server'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  progress: vi.fn(),
  listProgress: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: {
      programs: {
        list: mocks.list,
        progress: mocks.progress,
        listProgress: mocks.listProgress,
      },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import { GoalProgramError } from '../monthly-goals/goal-programs.server'
import { getGoalProgressSchema } from '../application/dto/goal-program.dto'
import { getGoalListProgress, getGoalProgress, listGoalPrograms } from './goal-programs'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const actor = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'AccountAdmin',
} as const
describe('canonical Goal Program server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('binds goal.use and the interactive permission to the resolved request', async () => {
    mocks.list.mockResolvedValue([])
    await withStartContext(() => listGoalPrograms({ data: { propertyId: PROPERTY_ID } }))
    const policy = mocks.list.mock.calls[0]?.[0] as GoalExecutionPolicy

    await policy.authorize({
      actor,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      action: 'goal.read',
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'goal.read',
      capability: 'goal.use',
      propertyId: PROPERTY_ID,
    })

    await expect(
      policy.authorize({
        actor: { ...actor, userId: 'another-user' },
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        action: 'goal.read',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('forwards Goal Program reads to Reporting, which scopes them', async () => {
    const assignedOnlyActor = {
      ...actor,
      effectivePermissions: new Set(['goal.read']),
      scopeByPermission: new Map([['goal.read', 'assigned-properties']]),
    }
    mocks.resolveTenantContext.mockResolvedValue(assignedOnlyActor)
    const program = { program: { id: 'program-1' }, assignments: [], results: [] }
    mocks.list.mockResolvedValue([program])
    // The container offers no People or Portal lookups, so any scoping left in
    // the server function would fail these calls.
    await withStartContext(() => listGoalPrograms({ data: { propertyId: PROPERTY_ID } }))

    expect(mocks.list).toHaveBeenCalledWith(
      expect.any(Object),
      PROPERTY_ID,
      assignedOnlyActor,
    )
  })

  it('answers a refused request with the status of its code', async () => {
    mocks.list.mockRejectedValue(new GoalProgramError('not_found'))

    await expect(
      withStartContext(() => listGoalPrograms({ data: { propertyId: PROPERTY_ID } })),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'not_found', status: 404 })
  })

  it('reads live goal progress for one subject through the request policy', async () => {
    const progress = [{ programId: 'program-1', reading: { kind: 'live', value: 3 } }]
    mocks.progress.mockResolvedValue(progress)
    const input = {
      propertyId: PROPERTY_ID,
      subject: {
        kind: 'portal_group' as const,
        portalGroupId: '00000000-0000-4000-8000-000000000005',
      },
    }

    await withStartContext(() => getGoalProgress({ data: input }))

    expect(mocks.progress).toHaveBeenCalledWith(expect.any(Object), input, actor)
  })

  it('reads the month so far of every goal on the Goals list in one call', async () => {
    mocks.listProgress.mockResolvedValue([
      { programId: 'program-1', subjectCount: 1, daysLeft: 14 },
    ])

    await withStartContext(() =>
      getGoalListProgress({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.listProgress).toHaveBeenCalledTimes(1)
    expect(mocks.listProgress).toHaveBeenCalledWith(
      expect.any(Object),
      { propertyId: PROPERTY_ID },
      actor,
    )
  })

  it('accepts a progress read only for a subject that is an id', () => {
    const subject = { kind: 'portal_group' as const, portalGroupId: 'not-an-id' }
    expect(
      getGoalProgressSchema.safeParse({ propertyId: PROPERTY_ID, subject }).success,
    ).toBe(false)
  })
})
