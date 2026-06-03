import { describe, it, expect, beforeEach } from 'vitest'
import { onRatingSubmitted, type OnRatingSubmittedDeps } from './on-rating-submitted'
import type { MetricReading } from '../../domain/types'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import {
  organizationId,
  portalId,
  propertyId,
  ratingId,
  metricReadingId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (): OnRatingSubmittedDeps & {
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
  }
}

describe('onRatingSubmitted', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a portal.rating reading with star value', async () => {
    const handler = onRatingSubmitted(deps)
    await handler({
      _tag: 'guest.rating.submitted',
      eventId: 'test-event-id',
      correlationId: null,
      ratingId: ratingId('rating-1'),
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      value: 4,
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.rating',
      value: 4,
      groupId: null,
    })
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnRatingSubmittedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
    }
    const handler = onRatingSubmitted(failingDeps)

    await expect(
      handler({
        _tag: 'guest.rating.submitted',
        eventId: 'test-event-id',
        correlationId: null,
        ratingId: ratingId('rating-1'),
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
        value: 5,
        occurredAt: FIXED_TIME,
      }),
    ).resolves.toBeUndefined()
  })

  it('sets groupId to null', async () => {
    const handler = onRatingSubmitted(deps)
    await handler({
      _tag: 'guest.rating.submitted',
      eventId: 'test-event-id',
      correlationId: null,
      ratingId: ratingId('rating-2'),
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      value: 4,
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.rating',
      value: 4,
      groupId: null,
    })
  })
})
