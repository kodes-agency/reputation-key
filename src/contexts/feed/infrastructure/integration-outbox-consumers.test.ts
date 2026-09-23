import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { createNotificationConsumerDeps } from './notification-consumer-test-fixtures'
import {
  handleNotificationGoogleAccountDisconnected,
  handleNotificationGoogleReauthorizationRequired,
  ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
  ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER,
  registerIntegrationNotificationConsumers,
} from './integration-outbox-consumers'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '83000000-0000-4000-8000-000000000001'
const ORG = organizationId('org-google-reauth-durable-notification')
const CONNECTION = googleConnectionId('83000000-0000-4000-8000-000000000002')
const PROPERTY = propertyId('83000000-0000-4000-8000-000000000003')
const ADMIN = userId('user-google-reauth-durable-notification')

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'integration.google_account.reauthorization_required',
  eventVersion: 1,
  payload: {
    connectionId: CONNECTION,
    organizationId: ORG,
    cause: 'member_removed',
    occurredAt: '2026-08-27T03:00:00.000Z',
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'integration',
  sourceAggregateId: CONNECTION,
  recordedAt: '2026-08-27T03:00:00.000Z',
  ...overrides,
})

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  fakes.userLookup.findByRole.mockResolvedValue([ADMIN])
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    googleConnectionProperties: {
      findGoogleNotificationAnchor: vi.fn(async () => PROPERTY),
    },
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => undefined) },
    fakes,
  }
}

describe('Google reauthorization notification durable consumer', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers and writes its receipt after deterministic fan-out', async () => {
    const deps = makeDeps()
    registerIntegrationNotificationConsumers(consumerRegistry, deps)
    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'integration.google_account.reauthorization_required',
      consumerName: ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER,
    })

    await expect(
      handleNotificationGoogleReauthorizationRequired(deps, event()),
    ).resolves.toEqual({ status: 'applied' })
    expect(deps.fakes.jobs).toHaveLength(1)
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_GOOGLE_REAUTHORIZATION_REQUIRED_CONSUMER,
      'applied',
    )
  })

  // A refresh Google refused for good records this cause. The fact used to be
  // rejected by the schema, so the admins were never told to reconnect.
  it('fans out a reauthorization Google caused by revoking the grant', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationGoogleReauthorizationRequired(
        deps,
        event({
          payload: {
            connectionId: CONNECTION,
            organizationId: ORG,
            cause: 'provider_revoked',
            occurredAt: '2026-08-27T03:00:00.000Z',
          },
        }),
      ),
    ).resolves.toEqual({ status: 'applied' })
    expect(deps.fakes.jobs).toEqual([
      expect.objectContaining({
        name: 'insert-notification',
        data: expect.objectContaining({
          userId: ADMIN,
          propertyId: PROPERTY,
          type: 'integration.reauthorization_required',
          resourceType: 'integration',
          resourceId: CONNECTION,
          payload: { reauthorizationCause: 'provider_revoked' },
          audience: { kind: 'account_admin' },
        }),
      }),
    ])
  })

  it('fails closed before fan-out or receipt on an Organization mismatch', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationGoogleReauthorizationRequired(
        deps,
        event({ organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.fakes.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})

const DISCONNECT_EVENT_ID = '83000000-0000-4000-8000-000000000004'
const OTHER_ADMIN = userId('user-google-disconnect-other-admin')

const disconnectEvent = (
  actorId: string | null = ADMIN,
  overrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: DISCONNECT_EVENT_ID,
  eventType: 'integration.google_account.disconnected',
  eventVersion: 1,
  payload: {
    connectionId: CONNECTION,
    organizationId: ORG,
    userId: actorId,
  },
  organizationId: ORG,
  propertyId: null,
  sourceContext: 'integration',
  sourceAggregateId: CONNECTION,
  recordedAt: '2026-08-27T03:00:00.000Z',
  ...overrides,
})

describe('a deliberate Google disconnect tells the other account admins', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('reaches every account admin except the one who disconnected', async () => {
    const deps = makeDeps()
    deps.userLookup.findByRole.mockResolvedValue([ADMIN, OTHER_ADMIN])

    await expect(
      handleNotificationGoogleAccountDisconnected(deps, disconnectEvent()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.fakes.jobs).toEqual([
      expect.objectContaining({
        name: 'insert-notification',
        data: expect.objectContaining({
          userId: OTHER_ADMIN,
          // The connection belongs to the Organization, not to a Property.
          propertyId: null,
          type: 'integration.google_disconnected',
          resourceType: 'integration',
          resourceId: CONNECTION,
          audience: { kind: 'organization_account_admin' },
        }),
      }),
    ])
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      DISCONNECT_EVENT_ID,
      ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
      'applied',
    )
  })

  // A disconnect the recovery reconciler completes names no actor; nobody is
  // excluded rather than everybody.
  it('reaches every account admin when the fact names no actor', async () => {
    const deps = makeDeps()
    deps.userLookup.findByRole.mockResolvedValue([ADMIN, OTHER_ADMIN])

    await handleNotificationGoogleAccountDisconnected(deps, disconnectEvent(null))

    expect(deps.fakes.jobs.map((job) => (job.data as { userId: string }).userId)).toEqual(
      [ADMIN, OTHER_ADMIN],
    )
  })

  it('queues nothing when the only admin is the one who disconnected', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationGoogleAccountDisconnected(deps, disconnectEvent()),
    ).resolves.toEqual({ status: 'applied' })

    expect(deps.fakes.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).toHaveBeenCalled()
  })

  it('fails closed before fan-out or receipt on an Organization mismatch', async () => {
    const deps = makeDeps()

    await expect(
      handleNotificationGoogleAccountDisconnected(
        deps,
        disconnectEvent(ADMIN, { organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.fakes.jobs).toEqual([])
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
