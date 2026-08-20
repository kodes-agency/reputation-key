import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  clearConsumers,
  listRegisteredConsumers,
  type ConsumerEvent,
} from '#/shared/outbox/dispatcher'
import type { PropertyGoogleBindingStore } from '../application/ports/property-google-binding.port'
import {
  handlePropertyRetentionReleased,
  registerPropertyRetentionConsumer,
} from './outbox-consumers'

const EVENT_ID = '30000000-0000-4000-8000-000000000001'
const ORG_ID = '00000000-0000-4000-8000-000000000001'
const IDEMPOTENCY_KEY = '40000000-0000-4000-8000-000000000001'
const RECORDED_AT = '2026-08-10T12:00:00.000Z'

const event = (overrides: Partial<ConsumerEvent> = {}): ConsumerEvent => ({
  eventId: EVENT_ID,
  eventType: 'integration.property_import.retention_released',
  eventVersion: 1,
  payload: { organizationId: ORG_ID, idempotencyKeys: [IDEMPOTENCY_KEY] },
  organizationId: ORG_ID,
  propertyId: null,
  sourceContext: 'integration',
  sourceAggregateId: 'import-parent-1',
  recordedAt: RECORDED_AT,
  ...overrides,
})

function store() {
  return {
    releaseRetentionFromEvent: vi.fn().mockResolvedValue('applied'),
  } as unknown as PropertyGoogleBindingStore
}

describe('Property import retention-release consumer', () => {
  beforeEach(() => {
    clearConsumers()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(() => {
    clearConsumers()
    clearEventSchemas()
  })

  it('registers the durable consumer identity declared in governance', () => {
    registerPropertyRetentionConsumer(store())
    expect(listRegisteredConsumers()).toContainEqual({
      eventType: 'integration.property_import.retention_released',
      consumerName: 'property.import-retention-release',
    })
  })

  it('passes validated identifier-only payloads and the durable event time to the store', async () => {
    const bindingStore = store()
    await expect(handlePropertyRetentionReleased(bindingStore, event())).resolves.toEqual(
      {
        status: 'applied',
      },
    )
    expect(bindingStore.releaseRetentionFromEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizationId: ORG_ID,
      idempotencyKeys: [IDEMPOTENCY_KEY],
      releasedAt: new Date(RECORDED_AT),
    })
  })

  it('fails closed on envelope attribution mismatch or missing durable time', async () => {
    await expect(
      handlePropertyRetentionReleased(store(), event({ organizationId: 'another-org' })),
    ).rejects.toThrow('attribution mismatch')
    await expect(
      handlePropertyRetentionReleased(store(), event({ recordedAt: undefined })),
    ).rejects.toThrow('recordedAt is invalid')
  })
})
