import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { makeDurableRecordMetricHandler } from './record-portal-metric'
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
