import { describe, it, expect, beforeEach, vi } from 'vitest'
import { onReviewCreated, type OnReviewCreatedDeps } from './on-review-created'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))
import type { MetricReading } from '../../domain/types'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import type { ReviewCreated } from '#/contexts/review/application/public-api'
import {
  organizationId,
  propertyId,
  reviewId,
  metricReadingId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (
  rating: number | null = 3,
): OnReviewCreatedDeps & {
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
        occurredAt: FIXED_TIME,
      } as MetricReading
    },
    reviewRatingLookup: {
      getEligibleRatingById: vi.fn(async () => rating),
    },
  }
}

const makeEvent = (overrides: Partial<ReviewCreated> = {}): ReviewCreated => ({
  _tag: 'review.created',
  eventId: 'test-event-id',
  correlationId: null,
  reviewId: reviewId('rev-1'),
  propertyId: propertyId('prop-1'),
  organizationId: organizationId('org-1'),
  platform: 'google',
  externalId: 'ext-1',
  occurredAt: FIXED_TIME,
  ...overrides,
})

describe('onReviewCreated', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a property.review reading with the looked-up rating and null portalId', async () => {
    const handler = onReviewCreated(deps)
    await handler(makeEvent())

    expect(deps.reviewRatingLookup.getEligibleRatingById).toHaveBeenCalledWith(
      reviewId('rev-1'),
      organizationId('org-1'),
    )
    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: null,
      metricKey: 'property.review',
      value: 3,
      groupId: null,
    })
  })

  it('records the exact rating value returned by the lookup', async () => {
    deps = createFakeDeps(5)
    const handler = onReviewCreated(deps)
    await handler(makeEvent({ reviewId: reviewId('rev-2'), externalId: 'ext-2' }))

    expect(deps.readings[0]!.value).toBe(5)
    expect(deps.readings[0]!.portalId).toBeNull()
  })

  it('records nothing when the review content is ineligible (lookup returns null)', async () => {
    deps = createFakeDeps(null)
    const recordMetric = vi.fn(deps.recordMetric)
    const handler = onReviewCreated({ ...deps, recordMetric })
    await handler(makeEvent())

    expect(recordMetric).not.toHaveBeenCalled()
    expect(deps.readings).toHaveLength(0)
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnReviewCreatedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
      reviewRatingLookup: {
        getEligibleRatingById: async () => 1,
      },
    }
    const handler = onReviewCreated(failingDeps)

    await expect(handler(makeEvent())).resolves.toBeUndefined()
  })
})
