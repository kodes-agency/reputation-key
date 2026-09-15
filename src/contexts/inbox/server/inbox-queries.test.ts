import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getInboxItems: vi.fn(),
  getInboxQueueCounts: vi.fn(),
  getInboxPropertyCounts: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  decideExecution: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    inboxPublicApi: {
      getInboxItems: mocks.getInboxItems,
      getInboxQueueCounts: mocks.getInboxQueueCounts,
      getInboxPropertyCounts: mocks.getInboxPropertyCounts,
    },
    logger: { warn: vi.fn() },
  })),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(() => ({ decide: mocks.decideExecution })),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  getInboxItemsFn,
  getInboxPropertyCountsFn,
  getInboxQueueCountsFn,
} from './inbox-queries'
import { getInboxPropertyCountsDto } from '../application/dto/inbox.dto'

const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  const global = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  global[START_KEY] ??= new AsyncLocalStorage()
  return global[START_KEY].run({ startOptions: {} }, fn)
}

const PROPERTY_ID = '750e8400-e29b-41d4-a716-446655440000'
const MANAGER = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'user-admin-1',
  role: 'AccountAdmin',
} as const
const STAFF = {
  ...MANAGER,
  userId: 'user-staff-1',
  role: 'Member',
} as const

describe('inbox query authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(MANAGER)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.decideExecution.mockResolvedValue({
      allowed: true,
      reason: 'allowed',
      action: 'reply.manage',
      policyVersion: 'test',
    })
    mocks.getInboxItems.mockResolvedValue({ items: [], totalCount: 0 })
    mocks.getInboxQueueCounts.mockResolvedValue({ open: 0 })
    mocks.getInboxPropertyCounts.mockResolvedValue({
      queue: 'open',
      total: 0,
      byProperty: {},
    })
  })

  it('binds queue counts to the requested property and enables available reply queues', async () => {
    await withStartContext(() =>
      getInboxQueueCountsFn({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledOnce()
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: MANAGER,
      action: 'inbox.read',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.decideExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'user', ctx: MANAGER },
        action: 'reply.manage',
        organizationId: MANAGER.organizationId,
        propertyId: PROPERTY_ID,
        executionKind: 'interactive',
      }),
    )
    expect(mocks.getInboxQueueCounts).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, replyQueuesEnabled: true },
      MANAGER,
    )
  })

  it('keeps non-reply manager counts available when reply publication is disabled', async () => {
    mocks.decideExecution.mockResolvedValue({
      allowed: false,
      reason: 'capability_disabled',
      action: 'reply.manage',
      policyVersion: 'test',
    })

    await withStartContext(() =>
      getInboxQueueCountsFn({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledOnce()
    expect(mocks.getInboxQueueCounts).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, replyQueuesEnabled: false },
      MANAGER,
    )
  })

  it('does not expose reply counts outside the reply permission property scope', async () => {
    mocks.decideExecution.mockResolvedValue({
      allowed: false,
      reason: 'scope_denied',
      action: 'reply.manage',
      policyVersion: 'test',
    })

    await withStartContext(() =>
      getInboxQueueCountsFn({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.getInboxQueueCounts).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, replyQueuesEnabled: false },
      MANAGER,
    )
  })

  it('requires reply policy authority before loading a reply-stage queue', async () => {
    await withStartContext(() =>
      getInboxItemsFn({ data: { queue: 'approval', propertyId: PROPERTY_ID } }),
    )

    expect(mocks.requireExecutionAllowed.mock.calls.map(([request]) => request)).toEqual([
      { actor: MANAGER, action: 'inbox.read', propertyId: PROPERTY_ID },
      { actor: MANAGER, action: 'reply.manage', propertyId: PROPERTY_ID },
    ])
  })

  it('keeps non-reply staff queue counts available after reply policy denial', async () => {
    mocks.resolveTenantContext.mockResolvedValue(STAFF)
    mocks.decideExecution.mockResolvedValue({
      allowed: false,
      reason: 'permission_denied',
      action: 'reply.manage',
      policyVersion: 'test',
    })

    await withStartContext(() =>
      getInboxQueueCountsFn({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledOnce()
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: STAFF,
      action: 'inbox.read',
      propertyId: PROPERTY_ID,
    })
    expect(mocks.getInboxQueueCounts).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, replyQueuesEnabled: false },
      STAFF,
    )
  })
  it('counts a queue per property under organization-level inbox authority', async () => {
    await withStartContext(() =>
      getInboxPropertyCountsFn({ data: { queue: 'feedback' } }),
    )

    expect(mocks.requireExecutionAllowed.mock.calls.map(([request]) => request)).toEqual([
      { actor: MANAGER, action: 'inbox.read' },
    ])
    expect(mocks.getInboxPropertyCounts).toHaveBeenCalledWith(
      { queue: 'feedback' },
      MANAGER,
    )
  })

  it('requires reply policy authority before counting a reply-stage queue per property', async () => {
    await withStartContext(() => getInboxPropertyCountsFn({ data: { queue: 'waiting' } }))

    expect(mocks.requireExecutionAllowed.mock.calls.map(([request]) => request)).toEqual([
      { actor: MANAGER, action: 'inbox.read' },
      { actor: MANAGER, action: 'reply.manage' },
    ])
    expect(mocks.getInboxPropertyCounts).toHaveBeenCalledWith(
      { queue: 'waiting' },
      MANAGER,
    )
  })

  it('does not count per property when reply policy refuses a reply-stage queue', async () => {
    mocks.requireExecutionAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('reply.manage refused'))

    await expect(
      withStartContext(() => getInboxPropertyCountsFn({ data: { queue: 'reply' } })),
    ).rejects.toThrow('reply.manage refused')
    expect(mocks.getInboxPropertyCounts).not.toHaveBeenCalled()
  })

  it('admits only a known queue at the boundary', () => {
    expect(getInboxPropertyCountsDto.safeParse({ queue: 'approval' }).success).toBe(true)
    expect(getInboxPropertyCountsDto.safeParse({ queue: 'everything' }).success).toBe(
      false,
    )
    expect(getInboxPropertyCountsDto.safeParse({}).success).toBe(false)
  })
})
