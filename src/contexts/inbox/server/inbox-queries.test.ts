import { withStartContext } from '#/shared/testing/tanstack-start-als'
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
    clock: () => CONTAINER_NOW,
  })),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
// Only the gate and the policy are stood in for: `refuseDecision` stays real, so
// the refusal a test sees is the tagged 403 the policy module really throws.
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/auth/execution-policy')>()),
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

const PROPERTY_ID = '750e8400-e29b-41d4-a716-446655440000'
/** Not the wall clock: a simulated or backdated container reads this one. */
const CONTAINER_NOW = new Date('2031-02-03T04:05:06.000Z')
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

  it('asks the reply policy at the container clock, not the wall clock (ADR 0017)', async () => {
    await withStartContext(() =>
      getInboxQueueCountsFn({ data: { propertyId: PROPERTY_ID } }),
    )

    expect(mocks.decideExecution.mock.calls.map(([request]) => request.now)).toEqual([
      CONTAINER_NOW,
    ])
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

  it('serves the reply queue without stages when the reply policy refuses, as every open Review', async () => {
    mocks.decideExecution.mockResolvedValue({
      allowed: false,
      reason: 'capability_disabled',
      action: 'reply.manage',
      policyVersion: 'test',
    })

    await withStartContext(() =>
      getInboxItemsFn({ data: { queue: 'reply', propertyId: PROPERTY_ID } }),
    )

    // Only the Inbox read is required: the reply row survives as "Open".
    expect(mocks.requireExecutionAllowed.mock.calls.map(([request]) => request)).toEqual([
      { actor: MANAGER, action: 'inbox.read', propertyId: PROPERTY_ID },
    ])
    expect(mocks.decideExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'user', ctx: MANAGER },
        action: 'reply.manage',
        propertyId: PROPERTY_ID,
        executionKind: 'interactive',
        now: CONTAINER_NOW,
      }),
    )
    expect(mocks.getInboxItems).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'reply', replyQueuesEnabled: false }),
      MANAGER,
    )
  })

  it('serves the reply queue with its stages when the reply policy allows', async () => {
    await withStartContext(() => getInboxItemsFn({ data: { queue: 'reply' } }))

    expect(mocks.getInboxItems).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'reply', replyQueuesEnabled: true }),
      MANAGER,
    )
  })

  it('asks no reply policy for a queue that does not depend on a reply', async () => {
    await withStartContext(() => getInboxItemsFn({ data: { queue: 'replied' } }))

    expect(mocks.decideExecution).not.toHaveBeenCalled()
    expect(mocks.getInboxItems).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'replied', replyQueuesEnabled: undefined }),
      MANAGER,
    )
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

  it('does not count per property when reply policy refuses a stage queue', async () => {
    mocks.requireExecutionAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('reply.manage refused'))

    await expect(
      withStartContext(() => getInboxPropertyCountsFn({ data: { queue: 'approval' } })),
    ).rejects.toThrow('reply.manage refused')
    expect(mocks.getInboxPropertyCounts).not.toHaveBeenCalled()
  })

  it('counts the reply queue per property without stages when the reply policy refuses', async () => {
    mocks.decideExecution.mockResolvedValue({
      allowed: false,
      reason: 'capability_disabled',
      action: 'reply.manage',
      policyVersion: 'test',
    })

    await withStartContext(() => getInboxPropertyCountsFn({ data: { queue: 'reply' } }))

    expect(mocks.requireExecutionAllowed.mock.calls.map(([request]) => request)).toEqual([
      { actor: MANAGER, action: 'inbox.read' },
    ])
    expect(mocks.getInboxPropertyCounts).toHaveBeenCalledWith(
      { queue: 'reply', replyQueuesEnabled: false },
      MANAGER,
    )
  })

  // A settled "no" is an answer: the stages are off. Each is a reason the policy
  // gives for a request it understood.
  it.each(['permission_denied', 'scope_denied', 'org_suspended', 'property_suspended'])(
    'reads %s as no reply stages, on the list and the per-property count',
    async (reason) => {
      mocks.decideExecution.mockResolvedValue({
        allowed: false,
        reason,
        action: 'reply.manage',
        policyVersion: 'test',
      })

      await withStartContext(() =>
        getInboxItemsFn({ data: { queue: 'reply', propertyId: PROPERTY_ID } }),
      )
      await withStartContext(() => getInboxPropertyCountsFn({ data: { queue: 'reply' } }))

      expect(mocks.getInboxItems).toHaveBeenCalledWith(
        expect.objectContaining({ queue: 'reply', replyQueuesEnabled: false }),
        MANAGER,
      )
      expect(mocks.getInboxPropertyCounts).toHaveBeenCalledWith(
        { queue: 'reply', replyQueuesEnabled: false },
        MANAGER,
      )
    },
  )

  // A policy that could not answer (its grant lookup failed) says nothing about
  // the stages. Read as "off" it served every open Review under the "Needs
  // reply" label the page draws from its own permissions, and flipped the rail
  // to "Open" through the counts, for as long as the outage lasted. It refuses,
  // as every other gated read does, and the page shows its retry state.
  describe('when the reply policy cannot answer', () => {
    beforeEach(() => {
      mocks.decideExecution.mockResolvedValue({
        allowed: false,
        reason: 'policy_unavailable',
        action: 'reply.manage',
        policyVersion: 'test',
      })
    })

    const refusal = { _tag: 'AuthError', code: 'policy_unavailable', status: 403 }

    it('refuses the reply queue instead of answering with every open Review', async () => {
      await expect(
        withStartContext(() =>
          getInboxItemsFn({ data: { queue: 'reply', propertyId: PROPERTY_ID } }),
        ),
      ).rejects.toMatchObject(refusal)

      expect(mocks.getInboxItems).not.toHaveBeenCalled()
    })

    it('refuses the reply queue count per property', async () => {
      await expect(
        withStartContext(() => getInboxPropertyCountsFn({ data: { queue: 'reply' } })),
      ).rejects.toMatchObject(refusal)

      expect(mocks.getInboxPropertyCounts).not.toHaveBeenCalled()
    })

    it('refuses the queue counts, so the rail cannot lose its stages to an outage', async () => {
      await expect(
        withStartContext(() =>
          getInboxQueueCountsFn({ data: { propertyId: PROPERTY_ID } }),
        ),
      ).rejects.toMatchObject(refusal)

      expect(mocks.getInboxQueueCounts).not.toHaveBeenCalled()
    })

    it('leaves a queue that depends on no reply alone', async () => {
      await withStartContext(() => getInboxItemsFn({ data: { queue: 'feedback' } }))

      expect(mocks.decideExecution).not.toHaveBeenCalled()
      expect(mocks.getInboxItems).toHaveBeenCalledOnce()
    })
  })

  it('admits only a known queue at the boundary', () => {
    expect(getInboxPropertyCountsDto.safeParse({ queue: 'approval' }).success).toBe(true)
    expect(getInboxPropertyCountsDto.safeParse({ queue: 'everything' }).success).toBe(
      false,
    )
    expect(getInboxPropertyCountsDto.safeParse({}).success).toBe(false)
  })
})
