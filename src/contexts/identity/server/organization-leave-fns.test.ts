import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  resetTenantCache: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  leaveOrganization: vi.fn(),
  listOutstanding: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      offboardingFacts: { listOutstanding: mocks.listOutstanding },
      requests: { leaveOrganization: mocks.leaveOrganization },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=old-cookie' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
  resetTenantCache: mocks.resetTenantCache,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { OutstandingResponsibilitiesError } from '../application/use-cases/leave-organization'
import {
  leaveOrganizationHandler,
  listOutstandingResponsibilitiesHandler,
} from './organization-leave-fns'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const ORG = '00000000-0000-4000-8000-000000000002'
const actor = { organizationId: ORG, userId: 'user-leaver', role: 'PropertyManager' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveTenantContext.mockResolvedValue(actor)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.leaveOrganization.mockResolvedValue({ success: true, transferred: 0 })
  mocks.listOutstanding.mockResolvedValue([])
})

describe('leave-Organization server functions', () => {
  it('gates the leave on the identity.leave_org permission', async () => {
    await withStartContext(() => leaveOrganizationHandler({ data: { transfers: [] } }))

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'identity.leave_org',
    })
  })

  /**
   * The durable session rows are deleted inside the command-store transaction.
   * The remaining risk is this process's tenant memo, which would keep
   * answering with the leaver's authority for the rest of its TTL — so the
   * handler must drop it as part of the same request.
   */
  it('invalidates the session cache immediately on success', async () => {
    await withStartContext(() => leaveOrganizationHandler({ data: { transfers: [] } }))

    expect(mocks.resetTenantCache).toHaveBeenCalledOnce()
  })

  it('does NOT invalidate the cache when the leave was refused', async () => {
    mocks.leaveOrganization.mockRejectedValue({
      _tag: 'IdentityError',
      code: 'last_owner',
      message: 'Appoint another AccountAdmin before leaving the Organization',
    })

    await expect(
      withStartContext(() => leaveOrganizationHandler({ data: { transfers: [] } })),
    ).rejects.toMatchObject({ code: 'last_owner' })
    expect(mocks.resetTenantCache).not.toHaveBeenCalled()
  })

  it('rejects a request whose session no longer resolves', async () => {
    // What a subsequent request with the old cookie sees: the session rows are
    // gone, so tenant resolution fails before any authority is consulted.
    mocks.resolveTenantContext.mockRejectedValue(
      Object.assign(new Error('Valid session required'), { code: 'unauthorized' }),
    )

    await expect(
      withStartContext(() => leaveOrganizationHandler({ data: { transfers: [] } })),
    ).rejects.toThrow(/Internal|session/iu)
    expect(mocks.leaveOrganization).not.toHaveBeenCalled()
    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })

  it('surfaces the outstanding worklist so the dialog can render the transfer step', async () => {
    const outstanding = [
      { kind: 'property_responsibility' as const, resourceId: 'property-1' },
    ]
    mocks.leaveOrganization.mockRejectedValue(
      new OutstandingResponsibilitiesError(outstanding),
    )

    const error = await withStartContext(() =>
      leaveOrganizationHandler({ data: { transfers: [] } }),
    ).catch((e: unknown) => e)

    expect(error).toMatchObject({ code: 'validation_error' })
    expect(mocks.resetTenantCache).not.toHaveBeenCalled()
  })

  it('passes the explicit transfers straight through — never inventing one', async () => {
    const transfers = [
      {
        kind: 'inbox_assignment' as const,
        resourceId: 'inbox-1',
        toUserId: 'user-successor',
      },
    ]

    await withStartContext(() => leaveOrganizationHandler({ data: { transfers } }))

    expect(mocks.leaveOrganization).toHaveBeenCalledWith({ transfers }, actor)
  })

  it('scopes the worklist read to the caller and their own Organization', async () => {
    mocks.listOutstanding.mockResolvedValue([
      { kind: 'portal_responsibility', resourceId: 'portal-1' },
    ])

    const result = await withStartContext(() => listOutstandingResponsibilitiesHandler())

    expect(mocks.listOutstanding).toHaveBeenCalledWith(ORG, 'user-leaver')
    expect(result.outstanding).toEqual([
      { kind: 'portal_responsibility', resourceId: 'portal-1' },
    ])
  })

  it('fails closed when the responsibility facts are not composed', async () => {
    mocks.listOutstanding.mockRejectedValue({
      _tag: 'IdentityError',
      code: 'forbidden',
      message:
        'Transfer-first leave is unavailable until responsibility facts are composed',
    })

    await expect(
      withStartContext(() => listOutstandingResponsibilitiesHandler()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
