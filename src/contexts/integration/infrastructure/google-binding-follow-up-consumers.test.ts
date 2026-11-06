import type { ManageNotificationsApi } from '../application/use-cases/manage-notifications'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import {
  createGoogleBindingFollowUpHandlers,
  registerGoogleBindingFollowUpConsumers,
  IMPORT_DISPLAY_NAME_CONSUMER,
  IMPORT_REVIEW_SYNC_CONSUMER,
  IMPORT_SUBSCRIPTION_CONSUMER,
} from './google-binding-follow-up-consumers'

const event: ConsumerEvent = {
  eventId: '10000000-0000-4000-8000-000000000001',
  eventType: 'property.google_binding.changed',
  eventVersion: 1,
  organizationId: 'org-follow-up',
  propertyId: '10000000-0000-4000-8000-000000000002',
  sourceContext: 'property',
  sourceAggregateId: '10000000-0000-4000-8000-000000000002',
  payload: {
    organizationId: 'org-follow-up',
    propertyId: '10000000-0000-4000-8000-000000000002',
    connectionId: '10000000-0000-4000-8000-000000000003',
    sourceEpoch: 1,
    change: 'created',
    importFollowUps: true,
    occurredAt: '2026-11-01T00:00:00.000Z',
  },
}
function setup() {
  const acknowledgements = new Set<string>()
  const binding = {
    state: 'active',
    deletedAt: null,
    lifecycleState: 'active',
    sourceEpoch: 1,
    connectionId: '10000000-0000-4000-8000-000000000003',
    accountId: 'account',
    locationId: 'location',
    name: 'Confirmed name',
  }
  const deps = {
    propertyBindingApi: {
      readInternal: vi.fn(async () => binding),
    } as unknown as PropertyGoogleBindingPublicApi,
    enqueueReviewSync: vi.fn(async () => undefined),
    defaultPublicDisplayName: vi.fn(async () => true),
    subscribe: vi.fn<ManageNotificationsApi['subscribe']>(async () => ({
      outcome: 'subscribed' as const,
      accounts: { subscribed: 1, alreadySubscribed: 0, failed: 0, failureCodes: {} },
    })),
    receipts: {
      hasReceipt: vi.fn(async (_id: string, name: string) => acknowledgements.has(name)),
      insertReceipt: vi.fn(async (_id: string, name: string) => {
        acknowledgements.add(name)
      }),
    },
    newDeliveryId: () => 'delivery',
  }
  return {
    deps,
    handlers: createGoogleBindingFollowUpHandlers(deps),
    acknowledgements,
    binding,
  }
}
beforeAll(registerAllEventSchemas)
describe('durable Google binding follow-ups', () => {
  it('registers three independent handlers so an outage cannot block the other effects', async () => {
    const { deps } = setup()
    const registry = createConsumerRegistry()
    registerGoogleBindingFollowUpConsumers(registry, deps)
    expect(registry.list()).toEqual([
      { eventType: event.eventType, consumerName: IMPORT_DISPLAY_NAME_CONSUMER },
      { eventType: event.eventType, consumerName: IMPORT_SUBSCRIPTION_CONSUMER },
      { eventType: event.eventType, consumerName: IMPORT_REVIEW_SYNC_CONSUMER },
    ])
  })
  it.each(['created', 'relinked'] as const)(
    'settles retained %s binding events without replaying finished imports',
    async (change) => {
      const { deps, handlers, acknowledgements } = setup()
      const { importFollowUps: _marker, ...payload } = event.payload as Record<
        string,
        unknown
      >
      for (const handler of Object.values(handlers))
        await expect(
          handler({ ...event, payload: { ...payload, change } }),
        ).resolves.toEqual({
          status: 'obsolete',
        })
      expect(acknowledgements.size).toBe(3)
      expect(deps.propertyBindingApi.readInternal).not.toHaveBeenCalled()
      expect(deps.defaultPublicDisplayName).not.toHaveBeenCalled()
      expect(deps.subscribe).not.toHaveBeenCalled()
      expect(deps.enqueueReviewSync).not.toHaveBeenCalled()
    },
  )
  it('initializes the conditional display name and acknowledges only after the effect', async () => {
    const { deps, handlers, acknowledgements } = setup()
    deps.defaultPublicDisplayName.mockRejectedValueOnce(new Error('store unavailable'))
    await expect(handlers.displayName(event)).rejects.toThrow(
      'Google import display name unavailable',
    )
    expect(acknowledgements.size).toBe(0)
    await expect(handlers.displayName(event)).resolves.toEqual({ status: 'applied' })
    expect(deps.defaultPublicDisplayName).toHaveBeenLastCalledWith({
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      displayName: 'Confirmed name',
    })
    await expect(handlers.displayName(event)).resolves.toEqual({ status: 'duplicate' })
    expect(deps.defaultPublicDisplayName).toHaveBeenCalledTimes(2)
  })
  it.each([
    'provider_failed',
    'authorization_unavailable',
    'account_unresolved',
  ] as const)('keeps %s subscription outcomes owed', async (outcome) => {
    const { deps, handlers, acknowledgements } = setup()
    deps.subscribe.mockResolvedValueOnce({
      outcome,
      accounts: { subscribed: 0, alreadySubscribed: 0, failed: 1, failureCodes: {} },
    })
    await expect(handlers.subscription(event)).rejects.toThrow('subscription incomplete')
    expect(acknowledgements.size).toBe(0)
    await expect(handlers.subscription(event)).resolves.toEqual({ status: 'applied' })
    expect(deps.subscribe).toHaveBeenLastCalledWith(
      event.organizationId,
      '10000000-0000-4000-8000-000000000003',
    )
  })
  it.each(['already_subscribed', 'topic_unset'] as const)(
    'settles %s subscription state',
    async (outcome) => {
      const { deps, handlers } = setup()
      deps.subscribe.mockResolvedValueOnce({
        outcome,
        accounts: { subscribed: 0, alreadySubscribed: 1, failed: 0, failureCodes: {} },
      })
      await expect(handlers.subscription(event)).resolves.toEqual({ status: 'applied' })
    },
  )
  it('keeps a thrown subscription failure owed while display-name work succeeds', async () => {
    const { deps, handlers, acknowledgements } = setup()
    deps.subscribe.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(handlers.subscription(event)).rejects.toThrow(
      'Google import subscription incomplete',
    )
    await handlers.displayName(event)
    expect([...acknowledgements]).toEqual([IMPORT_DISPLAY_NAME_CONSUMER])
  })
  it('does not acknowledge sync on Redis acceptance and retries lost deliveries', async () => {
    const { deps, handlers, acknowledgements } = setup()
    await expect(handlers.reviewSync(event)).rejects.toThrow(
      'awaiting durable acceptance',
    )
    expect(acknowledgements.size).toBe(0)
    expect(deps.enqueueReviewSync).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEpoch: 1,
        importBindingEventId: event.eventId,
        initiator: { kind: 'system', id: 'google-property-import' },
      }),
      { jobId: `review-sync-${event.eventId}-delivery` },
    )
    await expect(handlers.reviewSync(event)).rejects.toThrow(
      'awaiting durable acceptance',
    )
    expect(deps.enqueueReviewSync).toHaveBeenCalledTimes(2)
    acknowledgements.add(IMPORT_REVIEW_SYNC_CONSUMER)
    await expect(handlers.reviewSync(event)).resolves.toEqual({ status: 'duplicate' })
    expect(deps.enqueueReviewSync).toHaveBeenCalledTimes(2)
  })
  it.each(['sourceEpoch', 'state', 'lifecycleState', 'connectionId'] as const)(
    'settles stale %s work without effects',
    async (field) => {
      const { binding, deps, handlers } = setup()
      if (field === 'sourceEpoch') binding.sourceEpoch = 2
      else binding[field] = 'changed'
      for (const handler of Object.values(handlers))
        await expect(handler(event)).resolves.toEqual({ status: 'obsolete' })
      expect(deps.defaultPublicDisplayName).not.toHaveBeenCalled()
      expect(deps.subscribe).not.toHaveBeenCalled()
      expect(deps.enqueueReviewSync).not.toHaveBeenCalled()
    },
  )
  it('refuses a tenant attribution mismatch before reading the binding', async () => {
    const { deps, handlers } = setup()
    await expect(
      handlers.displayName({ ...event, organizationId: 'other' }),
    ).rejects.toThrow('Google import display name unavailable')
    expect(deps.propertyBindingApi.readInternal).not.toHaveBeenCalled()
  })
})
