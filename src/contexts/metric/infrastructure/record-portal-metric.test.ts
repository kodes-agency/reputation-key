import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import {
  makeDurablePortalMetricRetractionHandler,
  makeDurableRecordMetricHandler,
} from './record-portal-metric'
import { createMockLogger } from '#/shared/testing/mock-logger'

const event = {
  _tag: 'guest.rating.submitted',
  eventId: 'rating-correction-2',
  organizationId: organizationId('org-1'),
  propertyId: propertyId('00000000-0000-4000-8000-000000000001'),
  portalId: portalId('00000000-0000-4000-8000-000000000002'),
  supersedesSourceEventId: 'rating-original-1',
  occurredAt: new Date('2026-08-27T10:00:00.000Z'),
}

const option = {
  metricKey: 'portal.rating' as const,
  definitionVersionId: '11111111-1111-4111-8111-111111111202',
  sourcePolicy: 'first_party_guest_private' as const,
  span: 'metric.test.rating',
}

const retractionOptions = [
  {
    definitionVersionId: 'portal.rating.count@1',
    span: 'metric.rating.retracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
  {
    definitionVersionId: 'portal.rating.average@1',
    span: 'metric.rating.retracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
] as const
const retractionEvent = {
  _tag: 'guest.rating.retracted',
  eventId: 'retraction-event-1',
  organizationId: organizationId('org-1'),
  propertyId: propertyId('property-1'),
  portalId: portalId('portal-1'),
  supersedesSourceEventId: 'rating-event-1',
  occurredAt: new Date('2026-08-25T10:00:00Z'),
}

describe('durable Portal metric recording', () => {
  it('keeps an out-of-order replacement retryable until its original reading exists', async () => {
    const recordMetrics = vi.fn().mockResolvedValue([
      {
        status: 'quarantined',
        reason: 'superseded_reading_not_found',
        sourceEventId: event.eventId,
      },
    ])

    await expect(
      makeDurableRecordMetricHandler(option)({
        recordMetrics,
        findGroupForPortal: vi.fn().mockResolvedValue(null),
        logger: createMockLogger(),
      })(event),
    ).rejects.toThrow('superseded metric source reading is not available')
  })

  it('accepts an intentional governed quarantine that cannot be repaired by ordering', async () => {
    const recordMetrics = vi.fn().mockResolvedValue([
      {
        status: 'quarantined',
        reason: 'source_policy_not_allowed',
        sourceEventId: event.eventId,
      },
    ])

    await expect(
      makeDurableRecordMetricHandler(option)({
        recordMetrics,
        findGroupForPortal: vi.fn().mockResolvedValue(null),
        logger: createMockLogger(),
      })(event),
    ).resolves.toBeUndefined()
  })
})

describe('durable Portal metric retraction', () => {
  it('retracts every configured metric against the superseded source', async () => {
    const retractMetrics = vi
      .fn()
      .mockResolvedValue([{ status: 'retracted' }, { status: 'retracted' }])

    await makeDurablePortalMetricRetractionHandler(retractionOptions)({
      retractMetrics,
    })(retractionEvent)

    expect(retractMetrics).toHaveBeenCalledOnce()
    expect(retractMetrics).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          definitionVersionId: 'portal.rating.count@1',
          sourceEventId: 'retraction-event-1',
          supersedesSourceEventId: 'rating-event-1',
        }),
        expect.objectContaining({
          definitionVersionId: 'portal.rating.average@1',
        }),
      ],
      {
        eventId: 'retraction-event-1',
        consumerName: 'metric.guest-analytics',
      },
    )
  })

  it('keeps a missing original reading retryable', async () => {
    const retractMetrics = vi
      .fn()
      .mockResolvedValue([{ status: 'source_reading_not_found' }])

    await expect(
      makeDurablePortalMetricRetractionHandler(retractionOptions)({
        retractMetrics,
      })(retractionEvent),
    ).rejects.toThrow('metric source reading is not available for retraction')
  })
})
