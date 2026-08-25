import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  archive: vi.fn(),
  responsibilities: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    useCases: {
      createStaffParticipation: mocks.create,
      listStaffParticipations: mocks.list,
      archiveStaffParticipation: mocks.archive,
      updatePortalResponsibilities: mocks.responsibilities,
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
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  createStaffParticipation,
  listStaffParticipations,
  updatePortalResponsibilities,
} from './staff-participations'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const PARTICIPATION_ID = '00000000-0000-4000-8000-000000000002'
const actor = {
  organizationId: '00000000-0000-4000-8000-000000000003',
  userId: 'manager-1',
  role: 'AccountAdmin',
}

describe('staff participation server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('gates creation against the requested property and forwards the tenant actor', async () => {
    const participation = { id: PARTICIPATION_ID, propertyId: PROPERTY_ID }
    mocks.create.mockResolvedValue(participation)
    const data = {
      propertyId: PROPERTY_ID,
      displayName: 'Front Desk',
    }

    await withStartContext(() => createStaffParticipation({ data }))
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'staff.manage',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.create).toHaveBeenCalledWith(data, actor)
  })

  it('forwards an explicit active-only choice with the scoped list', async () => {
    mocks.list.mockResolvedValue([])

    await withStartContext(() =>
      listStaffParticipations({ data: { propertyId: PROPERTY_ID, activeOnly: false } }),
    )
    expect(mocks.list).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, activeOnly: false },
      actor,
    )
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'staff.read',
      propertyId: PROPERTY_ID,
    })
  })

  it('stops responsibility mutation when the execution gate denies it', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(new Error('execution denied'))

    await expect(
      withStartContext(() =>
        updatePortalResponsibilities({
          data: {
            staffParticipationId: PARTICIPATION_ID,
            primaryPortalId: PROPERTY_ID,
            supportingPortalIds: [],
            expectedRevision: 1,
          },
        }),
      ),
    ).rejects.toThrow('execution denied')
    expect(mocks.responsibilities).not.toHaveBeenCalled()
  })
})
