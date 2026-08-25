import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerConsumer: vi.fn(),
  validateEventPayload: vi.fn(
    (_type: string, _version: number, payload: unknown) => payload,
  ),
}))

vi.mock('#/shared/outbox/dispatcher', () => ({
  registerConsumer: mocks.registerConsumer,
}))
vi.mock('#/shared/events/schema-registry', () => ({
  validateEventPayload: mocks.validateEventPayload,
}))

import { registerGuestMetricConsumers } from './guest-outbox-consumers'

const common = {
  organizationId: 'org-1',
  propertyId: '00000000-0000-4000-8000-000000000001',
  portalId: '00000000-0000-4000-8000-000000000002',
  occurredAt: '2026-08-25T12:00:00.000Z',
}

describe('Guest metric durable consumers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers all Guest metric facts and applies a rating fanout', async () => {
    const recordMetric = vi.fn().mockResolvedValue({ status: 'recorded' })
    const retractMetric = vi.fn().mockResolvedValue({ status: 'retracted' })
    registerGuestMetricConsumers({
      recordMetric,
      retractMetric,
      findGroupForPortal: vi.fn().mockResolvedValue(null),
    })

    const registrations = mocks.registerConsumer.mock.calls.map(([value]) => value)
    expect(
      registrations.map(({ eventType, consumerName }) => ({
        eventType,
        consumerName,
      })),
    ).toEqual([
      {
        eventType: 'guest.scan.recorded',
        consumerName: 'metric.guest-analytics',
      },
      {
        eventType: 'guest.rating.submitted',
        consumerName: 'metric.guest-analytics',
      },
      {
        eventType: 'guest.rating.retracted',
        consumerName: 'metric.guest-analytics',
      },
      {
        eventType: 'guest.feedback.submitted',
        consumerName: 'metric.guest-analytics',
      },
      {
        eventType: 'guest.feedback.retracted',
        consumerName: 'metric.guest-analytics',
      },
      {
        eventType: 'guest.review_link.clicked',
        consumerName: 'metric.guest-analytics',
      },
    ])

    await registrations[1].handler({
      eventId: 'evt-rating',
      eventType: 'guest.rating.submitted',
      eventVersion: 1,
      payload: { ...common, ratingId: 'rating-1', value: 2 },
      organizationId: common.organizationId,
      propertyId: common.propertyId,
      sourceContext: 'guest',
      sourceAggregateId: 'rating-1',
    })

    expect(recordMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: 'evt-rating',
        value: 2,
        organizationId: common.organizationId,
        propertyId: common.propertyId,
        portalId: common.portalId,
      }),
    )

    await registrations[2].handler({
      eventId: 'evt-rating-retracted',
      eventType: 'guest.rating.retracted',
      eventVersion: 1,
      payload: {
        ...common,
        ratingId: 'rating-1',
        supersedesSourceEventId: 'evt-rating',
      },
      organizationId: common.organizationId,
      propertyId: common.propertyId,
      sourceContext: 'guest',
      sourceAggregateId: 'rating-1',
    })
    expect(retractMetric).toHaveBeenCalledTimes(3)
    expect(retractMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: 'evt-rating-retracted',
        supersedesSourceEventId: 'evt-rating',
      }),
    )
  })

  it('propagates metric persistence failures so the dispatcher can retry', async () => {
    const recordMetric = vi.fn().mockRejectedValue(new Error('database unavailable'))
    registerGuestMetricConsumers({
      recordMetric,
      retractMetric: vi.fn().mockResolvedValue({ status: 'retracted' }),
      findGroupForPortal: vi.fn().mockResolvedValue(null),
    })
    const registration = mocks.registerConsumer.mock.calls[0]![0]

    await expect(
      registration.handler({
        eventId: 'evt-scan',
        eventType: 'guest.scan.recorded',
        eventVersion: 1,
        payload: { ...common, scanId: 'scan-1', source: 'qr' },
        organizationId: common.organizationId,
        propertyId: common.propertyId,
        sourceContext: 'guest',
        sourceAggregateId: 'scan-1',
      }),
    ).rejects.toThrow('database unavailable')
  })
})
