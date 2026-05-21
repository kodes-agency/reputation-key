import { describe, it, expect, beforeEach } from 'vitest'
import {
  onFeedbackSubmitted,
  type OnFeedbackSubmittedDeps,
} from './on-feedback-submitted'
import type { MetricReading } from '../../domain/types'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import {
  organizationId,
  portalId,
  propertyId,
  feedbackId,
  ratingId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (): OnFeedbackSubmittedDeps & {
  readings: RecordMetricInput[]
} => {
  const readings: RecordMetricInput[] = []
  return {
    readings,
    recordMetric: async (input) => {
      readings.push({ ...input })
      return { id: 'metric-1', ...input, recordedAt: FIXED_TIME } as MetricReading
    },
  }
}

describe('onFeedbackSubmitted', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a portal.feedback reading with value 1', async () => {
    const handler = onFeedbackSubmitted(deps)
    await handler({
      _tag: 'feedback.submitted',
      feedbackId: feedbackId('fb-1'),
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      ratingId: ratingId('rating-1'),
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      metricKey: 'portal.feedback',
      value: 1,
    })
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnFeedbackSubmittedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
    }
    const handler = onFeedbackSubmitted(failingDeps)

    await expect(
      handler({
        _tag: 'feedback.submitted',
        feedbackId: feedbackId('fb-1'),
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
        ratingId: null,
        occurredAt: FIXED_TIME,
      }),
    ).resolves.toBeUndefined()
  })
})
