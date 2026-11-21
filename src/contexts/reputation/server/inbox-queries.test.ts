// The one fault the harness cannot provoke: the reply policy's grant lookup
// failing. Every other behaviour of these server functions is in
// inbox-queries.integration.test.ts and inbox-queries.reply-off.integration.test.ts.
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getInboxItems: vi.fn(),
  getInboxQueueCounts: vi.fn(),
  getInboxPropertyCounts: vi.fn(),
  decideExecution: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    inboxPublicApi: {
      getInboxItems: mocks.getInboxItems,
      getInboxQueueCounts: mocks.getInboxQueueCounts,
      getInboxPropertyCounts: mocks.getInboxPropertyCounts,
    },
    propertyPublicApi: { getPropertyTimezone: vi.fn() },
    logger: { warn: vi.fn() },
    clock: () => new Date('2031-02-03T04:05:06.000Z'),
  })),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(async () => ({
    organizationId: '00000000-0000-4000-8000-000000000001',
    userId: 'user-admin-1',
    role: 'AccountAdmin',
  })),
}))
// The gate and the policy are stood in for; `refuseDecision` stays real, so the
// refusal is the tagged 403 the policy module really throws.
vi.mock('#/shared/auth/execution-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/auth/execution-policy')>()),
  requireExecutionAllowed: vi.fn(async () => undefined),
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

const PROPERTY_ID = '750e8400-e29b-41d4-a716-446655440000'

// A policy that could not answer (its grant lookup failed) says nothing about
// the stages. Read as "off" it served every open Review under the "Needs
// reply" label the page draws from its own permissions, and flipped the rail
// to "Open" through the counts, for as long as the outage lasted. It refuses,
// as every other gated read does, and the page shows its retry state.
describe('when the reply policy cannot answer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mocks.getInboxItems.mockResolvedValue({ items: [], totalCount: 0 })

    await withStartContext(() => getInboxItemsFn({ data: { queue: 'feedback' } }))

    expect(mocks.decideExecution).not.toHaveBeenCalled()
    expect(mocks.getInboxItems).toHaveBeenCalledOnce()
  })
})
