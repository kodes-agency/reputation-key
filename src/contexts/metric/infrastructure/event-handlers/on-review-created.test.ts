import { describe, it, expect, beforeEach } from 'vitest'
import { onReviewCreated, type OnReviewCreatedDeps } from './on-review-created'
import type { MetricReading } from '../../domain/types'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import {
  organizationId,
  propertyId,
  reviewId,
  metricReadingId,
  staffId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (): OnReviewCreatedDeps & {
  readings: RecordMetricInput[]
} => {
  const readings: RecordMetricInput[] = []
  return {
    readings,
    recordMetric: async (input) => {
      readings.push({ ...input })
      return {
        id: metricReadingId('metric-1'),
        ...input,
        recordedAt: FIXED_TIME,
      } as MetricReading
    },
  }
}

describe('onReviewCreated', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a property.review reading with star value and null portalId', async () => {
    const handler = onReviewCreated(deps)
    await handler({
      _tag: 'review.created',
      reviewId: reviewId('rev-1'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      platform: 'google',
      externalId: 'ext-1',
      rating: 3,
      reviewText: 'Decent place',
      staffId: null,
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: null,
      metricKey: 'property.review',
      value: 3,
      staffId: null,
    })
  })

  it('records rating value even when review text is null', async () => {
    const handler = onReviewCreated(deps)
    await handler({
      _tag: 'review.created',
      reviewId: reviewId('rev-2'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      platform: 'google',
      externalId: 'ext-2',
      rating: 5,
      reviewText: null,
      staffId: null,
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings[0]!.value).toBe(5)
    expect(deps.readings[0]!.portalId).toBeNull()
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnReviewCreatedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
    }
    const handler = onReviewCreated(failingDeps)

    await expect(
      handler({
        _tag: 'review.created',
        reviewId: reviewId('rev-1'),
        propertyId: propertyId('prop-1'),
        organizationId: organizationId('org-1'),
        platform: 'google',
        externalId: 'ext-1',
        rating: 1,
        reviewText: null,
        staffId: null,
        occurredAt: FIXED_TIME,
      }),
    ).resolves.toBeUndefined()
  })

  it('propagates non-null staffId to the metric reading', async () => {
    const handler = onReviewCreated(deps)
    await handler({
      _tag: 'review.created',
      reviewId: reviewId('rev-3'),
      propertyId: propertyId('prop-1'),
      organizationId: organizationId('org-1'),
      platform: 'google',
      externalId: 'ext-3',
      rating: 4,
      reviewText: 'Great place',
      staffId: staffId('staff-1'),
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: null,
      metricKey: 'property.review',
      value: 4,
      staffId: staffId('staff-1'),
    })
  })
})
