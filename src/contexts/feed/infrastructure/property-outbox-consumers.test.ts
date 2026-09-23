import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  createNotificationConsumerDeps,
  NOTIF_TEST_IDS,
} from './notification-consumer-test-fixtures'
import {
  handleNotificationPropertyResponsibilityNeeded,
  ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER,
  registerPropertyNotificationConsumers,
} from './property-outbox-consumers'
import { unbrand } from '#/shared/domain/ids'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENT_ID = '30000000-0000-4000-8000-000000000003'

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'property.responsibility_became_needed',
  eventVersion: 1,
  payload: {
    organizationId: unbrand(NOTIF_TEST_IDS.orgId),
    propertyId: unbrand(NOTIF_TEST_IDS.propId),
    occurredAt: NOTIF_TEST_IDS.now.toISOString(),
  },
  organizationId: unbrand(NOTIF_TEST_IDS.orgId),
  propertyId: unbrand(NOTIF_TEST_IDS.propId),
  sourceContext: 'property',
  sourceAggregateId: unbrand(NOTIF_TEST_IDS.propId),
  recordedAt: '2026-06-01T11:59:00.000Z',
  ...overrides,
})

const makeDeps = () => {
  const fakes = createNotificationConsumerDeps()
  return {
    queue: fakes.queue,
    userLookup: fakes.userLookup,
    displayNames: fakes.displayNames,
    logger: fakes.logger,
    receipts: { insertReceipt: vi.fn(async () => {}) },
    fakes,
  }
}

describe('Property notification durable consumer', () => {
  beforeEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => {
    consumerRegistry = createConsumerRegistry()
    clearEventSchemas()
  })

  it('registers under its Property-gated consumer identity', () => {
    registerPropertyNotificationConsumers(consumerRegistry, makeDeps())
    expect(consumerRegistry.list()).toContainEqual({
      eventType: 'property.responsibility_became_needed',
      consumerName: ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER,
    })
  })

  it('fans out deterministically and writes an applied receipt', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await expect(
      handleNotificationPropertyResponsibilityNeeded(deps, event()),
    ).resolves.toEqual({ status: 'applied' })
    expect(deps.fakes.jobs[0]?.opts).toEqual({
      jobId: `${EVENT_ID}-${NOTIF_TEST_IDS.admin1}`,
    })
    expect(deps.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_PROPERTY_RESPONSIBILITY_NEEDED_CONSUMER,
      'applied',
    )
  })

  it('asks AccountAdmins only for as long as the Property still has no manager', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await handleNotificationPropertyResponsibilityNeeded(deps, event())

    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      type: 'property.responsibility_needed',
      payload: { propertyName: 'Riverside Hotel' },
      audience: {
        kind: 'responsibility_gap',
        scope: { kind: 'property', propertyId: NOTIF_TEST_IDS.propId },
      },
    })
    expect(deps.fakes.displayNames.findPropertyName).toHaveBeenCalledWith(
      NOTIF_TEST_IDS.orgId,
      NOTIF_TEST_IDS.propId,
    )
  })

  it('still asks when the Property name cannot be read', async () => {
    const deps = makeDeps()
    deps.fakes.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])
    deps.fakes.displayNames.findPropertyName.mockRejectedValue(new Error('db down'))

    await handleNotificationPropertyResponsibilityNeeded(deps, event())

    expect(deps.fakes.jobs[0]?.data).toMatchObject({
      type: 'property.responsibility_needed',
      payload: {},
    })
  })

  it('fails closed on Organization or Property attribution mismatch', async () => {
    const deps = makeDeps()
    await expect(
      handleNotificationPropertyResponsibilityNeeded(
        deps,
        event({ organizationId: 'another-org' }),
      ),
    ).rejects.toThrow('attribution mismatch')
    expect(deps.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
