import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearConsumers, listRegisteredConsumers } from '#/shared/outbox/dispatcher'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import { registerPortalWorkflowMetricConsumers } from '../outbox-consumers'

beforeEach(() => {
  clearConsumers()
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
})
