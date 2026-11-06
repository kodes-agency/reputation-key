import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { ENTRY_POINT_CATALOGUE } from '#/shared/governance/entry-point-catalogue'
import { createDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import {
  GOOGLE_CATEGORY_REFRESH_CONSUMER,
  registerGoogleCategoryRefreshConsumer,
} from './google-category-refresh-outbox-consumers'

const NOW = new Date('2026-11-06T10:00:00Z')

function setup() {
  const actor = buildTestAuthContext({ role: 'AccountAdmin' })
  const connection = buildTestGoogleConnection({ credentialAuthorizedBy: actor.userId })
  const event: ConsumerEvent = {
    eventId: '79000000-0000-4000-8000-000000000001',
    eventType: 'integration.google_account.connected',
    eventVersion: 3,
    organizationId: actor.organizationId,
    propertyId: null,
    sourceContext: 'integration',
    sourceAggregateId: connection.id,
    occurredAt: NOW.toISOString(),
    payload: {
      organizationId: actor.organizationId,
      connectionId: connection.id,
      userId: actor.userId,
    },
  }
  const deps = {
    findConnection: vi.fn(async () => connection),
    resolveActor: vi.fn(async () => actor),
    refresh: vi.fn(async () => {}),
    receipts: { insertReceipt: vi.fn(async () => {}) },
  }
  const registry = createConsumerRegistry()
  registerGoogleCategoryRefreshConsumer(registry, deps)
  const handler = registry.listFor(event.eventType)[0]!.handler
  return { actor, connection, event, deps, run: () => handler(event) }
}

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})
afterAll(() => clearEventSchemas())
afterEach(() => resetCapabilityPolicyStore())

describe('durable Google category refresh', () => {
  it('reaches retryable provider admission even while the import capability is refused', async () => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    const policy = createDelayedExecutionPolicy({ refreshPolicy: async () => {} })
    const row = ENTRY_POINT_CATALOGUE.find(
      (entry) =>
        entry.kind === 'consumer' && entry.name === GOOGLE_CATEGORY_REFRESH_CONSUMER,
    )
    if (!row) throw new Error('Category refresh consumer policy missing')
    const request = {
      principal: { kind: 'system' as const, id: 'consumer:category-refresh' },
      organizationId: 'not-allowlisted',
      executionKind: 'consumer' as const,
      now: NOW,
    }
    expect(
      await policy.decide({ ...request, action: 'system:property.import_v2' }),
    ).toMatchObject({ allowed: false })
    expect(
      await policy.decide({
        ...request,
        action: row.action,
        resourceScope: row.resourceScope,
      }),
    ).toMatchObject({ allowed: true })
  })
  it.each([
    new Error('provider unavailable'),
    Object.assign(new Error('import capability unavailable'), { code: 'oauth_failed' }),
  ])(
    'leaves a failed lookup recoverable and retries with the original request identity: %o',
    async (failure) => {
      const subject = setup()
      subject.deps.refresh.mockRejectedValueOnce(failure)
      await expect(subject.run()).rejects.toBe(failure)
      expect(subject.deps.receipts.insertReceipt).not.toHaveBeenCalled()

      await expect(subject.run()).resolves.toEqual({ status: 'applied' })
      expect(subject.deps.refresh).toHaveBeenNthCalledWith(
        1,
        subject.connection,
        subject.actor,
        subject.event.eventId,
      )
      expect(subject.deps.refresh).toHaveBeenNthCalledWith(
        2,
        subject.connection,
        subject.actor,
        subject.event.eventId,
      )
      expect(subject.deps.receipts.insertReceipt).toHaveBeenCalledExactlyOnceWith(
        subject.event.eventId,
        GOOGLE_CATEGORY_REFRESH_CONSUMER,
        'applied',
      )
    },
  )

  it('does not record completion when the refresh is still running', async () => {
    const subject = setup()
    const started = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    subject.deps.refresh.mockImplementationOnce(async () => {
      started.resolve()
      await released.promise
    })
    const running = subject.run()
    try {
      await started.promise
      expect(subject.deps.receipts.insertReceipt).not.toHaveBeenCalled()
    } finally {
      released.resolve()
      await running
    }
    expect(subject.deps.receipts.insertReceipt).toHaveBeenCalledOnce()
  })

  it('retires a delivery after disconnect without making a provider call', async () => {
    const subject = setup()
    subject.deps.findConnection.mockResolvedValue({
      ...subject.connection,
      status: 'disconnected',
    })
    await expect(subject.run()).resolves.toEqual({ status: 'obsolete' })
    expect(subject.deps.refresh).not.toHaveBeenCalled()
    expect(subject.deps.receipts.insertReceipt).toHaveBeenCalledWith(
      subject.event.eventId,
      GOOGLE_CATEGORY_REFRESH_CONSUMER,
      'obsolete',
    )
  })

  it('rejects an event attributed to another tenant before any lookup', async () => {
    const subject = setup()
    subject.event = { ...subject.event, organizationId: 'another-organization' }
    const registry = createConsumerRegistry()
    registerGoogleCategoryRefreshConsumer(registry, subject.deps)
    await expect(
      registry.listFor(subject.event.eventType)[0]!.handler(subject.event),
    ).rejects.toThrow('attribution mismatch')
    expect(subject.deps.findConnection).not.toHaveBeenCalled()
    expect(subject.deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
