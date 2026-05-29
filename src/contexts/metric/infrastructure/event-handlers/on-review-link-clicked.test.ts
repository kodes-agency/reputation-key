import { describe, it, expect, beforeEach } from 'vitest'
import {
  onReviewLinkClicked,
  type OnReviewLinkClickedDeps,
} from './on-review-link-clicked'
import type { MetricReading } from '../../domain/types'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import {
  organizationId,
  portalId,
  propertyId,
  metricReadingId,
  portalLinkId,
} from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-05-20T12:00:00Z')

const createFakeDeps = (): OnReviewLinkClickedDeps & {
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

describe('onReviewLinkClicked', () => {
  let deps: ReturnType<typeof createFakeDeps>

  beforeEach(() => {
    deps = createFakeDeps()
  })

  it('records a portal.review_link_click reading with value 1', async () => {
    const handler = onReviewLinkClicked(deps)
    await handler({
      _tag: 'review-link.clicked',
      linkId: portalLinkId('link-1'),
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.review_link_click',
      value: 1,
      groupId: null,
    })
  })

  it('does not throw when recordMetric fails', async () => {
    const failingDeps: OnReviewLinkClickedDeps = {
      recordMetric: async () => {
        throw new Error('DB unavailable')
      },
    }
    const handler = onReviewLinkClicked(failingDeps)

    await expect(
      handler({
        _tag: 'review-link.clicked',
        linkId: portalLinkId('link-1'),
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
        occurredAt: FIXED_TIME,
      }),
    ).resolves.toBeUndefined()
  })

  it('sets groupId to null', async () => {
    const handler = onReviewLinkClicked(deps)
    await handler({
      _tag: 'review-link.clicked',
      linkId: portalLinkId('link-2'),
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      occurredAt: FIXED_TIME,
    })

    expect(deps.readings).toHaveLength(1)
    expect(deps.readings[0]).toEqual({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('prop-1'),
      portalId: portalId('portal-1'),
      metricKey: 'portal.review_link_click',
      value: 1,
      groupId: null,
    })
  })
})
