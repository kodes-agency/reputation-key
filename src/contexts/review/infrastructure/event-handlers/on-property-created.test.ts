import { describe, it, expect, vi } from 'vitest'
import { onPropertyCreated } from './on-property-created'
import { propertyId, organizationId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const makeQueue = () => {
  const enqueued: Array<Record<string, unknown>> = []
  return {
    queue: {
      addSyncJob: async (data: Record<string, unknown>) => {
        enqueued.push(data)
      },
    },
    enqueued,
  }
}

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  _tag: 'property.created' as const,
  eventId: 'test-event-id',
  correlationId: null,
  propertyId: propertyId('e0000000-0000-0000-0000-000000000001'),
  organizationId: organizationId('e0000000-0000-0000-0000-000000000002'),
  name: 'Test Property',
  slug: 'test-property',
  occurredAt: FIXED_TIME,
  ...overrides,
})

describe('onPropertyCreated', () => {
  it('enqueues sync job when gbpLocationName and googleConnectionId are present', async () => {
    const { queue, enqueued } = makeQueue()
    const handler = onPropertyCreated({ queue })

    const event = makeEvent({
      gbpLocationName: 'accounts/123/locations/456',
      googleConnectionId: 'e0000000-0000-0000-0000-000000000003',
    })

    await handler(event)

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toEqual({
      propertyId: event.propertyId,
      organizationId: event.organizationId,
      connectionId: 'e0000000-0000-0000-0000-000000000003',
      locationName: 'accounts/123/locations/456',
    })
  })

  it('skips when gbpLocationName is missing', async () => {
    const { queue, enqueued } = makeQueue()
    const handler = onPropertyCreated({ queue })

    const event = makeEvent({
      googleConnectionId: 'e0000000-0000-0000-0000-000000000003',
    })

    await handler(event)

    expect(enqueued).toHaveLength(0)
  })

  it('skips when googleConnectionId is missing', async () => {
    const { queue, enqueued } = makeQueue()
    const handler = onPropertyCreated({ queue })

    const event = makeEvent({
      gbpLocationName: 'accounts/123/locations/456',
    })

    await handler(event)

    expect(enqueued).toHaveLength(0)
  })

  it('does not throw when queue.addSyncJob fails', async () => {
    const queue = {
      addSyncJob: vi.fn(async () => {
        throw new Error('Redis unavailable')
      }),
    }
    const handler = onPropertyCreated({ queue })

    const event = makeEvent({
      gbpLocationName: 'accounts/123/locations/456',
      googleConnectionId: 'e0000000-0000-0000-0000-000000000003',
    })

    await expect(handler(event)).resolves.toBeUndefined()
  })
})
