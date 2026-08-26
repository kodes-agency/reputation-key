import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearConsumers,
  listRegisteredConsumers,
  registeredConsumersFor,
} from '#/shared/outbox/consumer-registry'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { registerPortalWorkflowMetricConsumers } from '../outbox-consumers'

beforeEach(() => {
  clearConsumers()
  clearEventSchemas()
  registerAllEventSchemas()
})

describe('Portal metric durable registration', () => {
  it('registers a durable production consumer for every beta-safe Portal fact', () => {
    registerPortalWorkflowMetricConsumers({
      recordMetric: vi.fn(async (input: RecordMetricInput) => ({
        status: 'duplicate' as const,
        existingReadingId: input.sourceEventId,
      })),
      resolveAttribution: async () => null,
    })

    expect(
      listRegisteredConsumers()
        .filter((registration) => registration.consumerName === 'metric.portal-workflow')
        .map((registration) => registration.eventType)
        .sort(),
    ).toEqual([
      'portal.approved_destination_ratio.recorded',
      'portal.configuration_completeness.recorded',
      'portal.content_review.completed',
    ])
  })

  it.each([
    { eventVersion: 1, includeAggregateRevision: false },
    { eventVersion: 2, includeAggregateRevision: true },
  ])('consumes Portal workflow v$eventVersion replay envelopes', async (version) => {
    const recordMetric = vi.fn(async (input: RecordMetricInput) => ({
      status: 'duplicate' as const,
      existingReadingId: input.sourceEventId,
    }))
    registerPortalWorkflowMetricConsumers({
      recordMetric,
      resolveAttribution: async () => null,
    })
    const [registration] = registeredConsumersFor('portal.content_review.completed')
    const occurredAt = '2026-08-09T12:00:00.000Z'
    const payload = {
      reviewId: 'review-1',
      revision: 1,
      organizationId: 'org-1',
      propertyId: 'property-1',
      portalId: 'portal-1',
      portalGroupId: null,
      supersedesSourceEventId: null,
      occurredAt,
      ...(version.includeAggregateRevision
        ? { sourceAggregateVersion: '2026-08-09T13:00:00.001Z' }
        : {}),
    }

    await expect(
      registration!.handler({
        eventId: `event-v${version.eventVersion}`,
        eventType: 'portal.content_review.completed',
        eventVersion: version.eventVersion,
        payload,
        organizationId: 'org-1',
        propertyId: 'property-1',
        sourceContext: 'portal',
        sourceAggregateId: 'portal-1',
        recordedAt: occurredAt,
      }),
    ).resolves.toEqual({ status: 'applied' })
    expect(recordMetric).toHaveBeenCalledOnce()
  })
})
