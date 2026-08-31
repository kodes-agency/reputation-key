import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerRegistry } from '#/shared/outbox'

const mocks = vi.hoisted(() => ({
  registerConsumer: vi.fn(),
  validateEventPayload: vi.fn(
    (_type: string, _version: number, payload: unknown) => payload,
  ),
}))

vi.mock('#/shared/events/schema-registry', () => ({
  validateEventPayload: mocks.validateEventPayload,
}))

// ARC-03-T7: the consumers register on the registry they are handed, so the
// spy is a stand-in registry rather than a mocked module export.
const consumerRegistry = {
  registerConsumer: mocks.registerConsumer,
} as unknown as ConsumerRegistry

import { registerGuestMetricConsumers } from './guest-outbox-consumers'
import { createMockLogger } from '#/shared/testing/mock-logger'

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
    registerGuestMetricConsumers(consumerRegistry, {
      recordMetric,
      retractMetric,
      findGroupForPortal: vi.fn().mockResolvedValue(null),
      logger: createMockLogger(),
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
        eventType: 'guest.qualified_scan.recorded',
        consumerName: 'metric.guest-analytics',
      },
      {
        eventType: 'guest.qualified_scan.retracted',
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

    await registrations[3].handler({
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

    await registrations[4].handler({
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

  it('replays Qualified Scans with their captured group and correction source', async () => {
    const recordMetric = vi.fn().mockResolvedValue({ status: 'recorded' })
    const retractMetric = vi.fn().mockResolvedValue({ status: 'retracted' })
    const findGroupForPortal = vi.fn()
    registerGuestMetricConsumers(consumerRegistry, {
      recordMetric,
      retractMetric,
      findGroupForPortal,
      logger: createMockLogger(),
    })
    const registrations = mocks.registerConsumer.mock.calls.map(([value]) => value)
    const recorded = registrations.find(
      ({ eventType }) => eventType === 'guest.qualified_scan.recorded',
    )
    const retracted = registrations.find(
      ({ eventType }) => eventType === 'guest.qualified_scan.retracted',
    )
    const payload = {
      ...common,
      qualifiedScanId: '72000000-0000-4000-8000-000000000001',
      portalGroupId: '72000000-0000-4000-8000-000000000002',
      accessArtifactId: '72000000-0000-4000-8000-000000000003',
    }

    await recorded.handler({
      eventId: '72000000-0000-4000-8000-000000000004',
      eventType: 'guest.qualified_scan.recorded',
      eventVersion: 1,
      payload,
      organizationId: common.organizationId,
      propertyId: common.propertyId,
      sourceContext: 'guest',
      sourceAggregateId: payload.qualifiedScanId,
    })
    await retracted.handler({
      eventId: '72000000-0000-4000-8000-000000000005',
      eventType: 'guest.qualified_scan.retracted',
      eventVersion: 1,
      payload: {
        ...payload,
        supersedesSourceEventId: '72000000-0000-4000-8000-000000000004',
      },
      organizationId: common.organizationId,
      propertyId: common.propertyId,
      sourceContext: 'guest',
      sourceAggregateId: payload.qualifiedScanId,
    })

    expect(findGroupForPortal).not.toHaveBeenCalled()
    expect(recordMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: '72000000-0000-4000-8000-000000000004',
        portalGroupId: payload.portalGroupId,
        definitionVersionId: '11111111-1111-4111-8111-111111111301',
      }),
    )
    expect(retractMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEventId: '72000000-0000-4000-8000-000000000005',
        supersedesSourceEventId: '72000000-0000-4000-8000-000000000004',
      }),
    )
  })

  it('propagates metric persistence failures so the dispatcher can retry', async () => {
    const recordMetric = vi.fn().mockRejectedValue(new Error('database unavailable'))
    registerGuestMetricConsumers(consumerRegistry, {
      recordMetric,
      retractMetric: vi.fn().mockResolvedValue({ status: 'retracted' }),
      findGroupForPortal: vi.fn().mockResolvedValue(null),
      logger: createMockLogger(),
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

  it.each([
    { eventVersion: 1, sourceField: { source: 'qr' as const } },
    { eventVersion: 2, sourceField: { scanSource: 'nfc' as const } },
  ])(
    'replays the versioned scan-source vocabulary for v$eventVersion',
    async ({ eventVersion, sourceField }) => {
      const recordMetric = vi.fn().mockResolvedValue({ status: 'recorded' })
      registerGuestMetricConsumers(consumerRegistry, {
        recordMetric,
        retractMetric: vi.fn().mockResolvedValue({ status: 'retracted' }),
        findGroupForPortal: vi.fn().mockResolvedValue(null),
        logger: createMockLogger(),
      })
      const registration = mocks.registerConsumer.mock.calls[0]![0]

      await registration.handler({
        eventId: `evt-scan-v${eventVersion}`,
        eventType: 'guest.scan.recorded',
        eventVersion,
        payload: { ...common, scanId: `scan-v${eventVersion}`, ...sourceField },
        organizationId: common.organizationId,
        propertyId: common.propertyId,
        sourceContext: 'guest',
        sourceAggregateId: `scan-v${eventVersion}`,
      })

      expect(recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceEventId: `evt-scan-v${eventVersion}`,
          value: 1,
        }),
      )
    },
  )
})
