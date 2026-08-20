import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalExecutionPolicy } from '../application/use-cases/governed-goals'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  revise: vi.fn(),
  changeStatus: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  createService: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    useCases: { createGovernedGoalService: mocks.createService },
    staffPublicApi: { getAssignedPortals: vi.fn(async () => []) },
    portalPublicApi: {
      portalGroup: { findGroupIdsByPortalIds: vi.fn(async () => []) },
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

import { createGovernedGoal } from './governed-goals'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const METRIC_VERSION_ID = '00000000-0000-4000-8000-000000000003'
const actor = { organizationId: ORG_ID, userId: 'user-1', role: 'AccountAdmin' } as const
const validInput = {
  propertyId: PROPERTY_ID,
  scope: { kind: 'property' as const },
  name: 'Monthly service score',
  description: null,
  metricDefinitionVersionId: METRIC_VERSION_ID,
  measureKind: 'progress' as const,
  targetValue: 90,
  sourcePolicy: 'portal_configuration',
  recurrenceRule: { frequency: 'monthly' as const, interval: 1, dayOfMonth: 1 },
}

describe('governed goal server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.createService.mockReturnValue({
      create: mocks.create,
      revise: mocks.revise,
      changeStatus: mocks.changeStatus,
      get: mocks.get,
      list: mocks.list,
    })
  })

  it('forwards validated creation data with the resolved manager actor', async () => {
    const created = { definition: { id: 'definition-1' } }
    mocks.create.mockResolvedValue(created)

    await withStartContext(() => createGovernedGoal({ data: validInput }))
    expect(mocks.create).toHaveBeenCalledWith(validInput, actor)
  })

  it('binds the request execution policy to the resolved organization and user', async () => {
    mocks.create.mockResolvedValue({ ok: true })
    await withStartContext(() => createGovernedGoal({ data: validInput }))
    const policy = mocks.createService.mock.calls[0]?.[0] as GoalExecutionPolicy

    await expect(
      policy.authorize({
        actor,
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        action: 'goal.create',
      }),
    ).resolves.toBeUndefined()
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'goal.create',
      propertyId: PROPERTY_ID,
    })

    await expect(
      policy.authorize({
        actor: { ...actor, userId: 'other-user' },
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        action: 'goal.create',
      }),
    ).rejects.toThrow('Forbidden')
  })
})
