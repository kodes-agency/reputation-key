import { describe, expect, it, vi } from 'vitest'
import {
  makeDurablePortalMetricRetractionHandler,
  makePortalMetricRetractionHandler,
} from './retract-portal-metric'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'

const options = [
  { definitionVersionId: 'portal.rating.count@1', span: 'metric.rating.retracted' },
  { definitionVersionId: 'portal.rating.average@1', span: 'metric.rating.retracted' },
] as const
const event = {
  _tag: 'guest.rating.retracted',
  eventId: 'retraction-event-1',
  organizationId: organizationId('org-1'),
  propertyId: propertyId('property-1'),
  portalId: portalId('portal-1'),
  supersedesSourceEventId: 'rating-event-1',
  occurredAt: new Date('2026-08-25T10:00:00Z'),
}

describe('Portal metric retraction handlers', () => {
  it('durably retracts every configured metric against the superseded source', async () => {
    const retract = vi.fn().mockResolvedValue({ status: 'retracted' })
    await makeDurablePortalMetricRetractionHandler(options)({
      retractMetric: retract,
    })(event)

    expect(retract).toHaveBeenCalledTimes(2)
    expect(retract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        definitionVersionId: 'portal.rating.count@1',
        sourceEventId: 'retraction-event-1',
        supersedesSourceEventId: 'rating-event-1',
      }),
    )
  })

  it('keeps a missing original reading retryable on the durable path', async () => {
    const retract = vi.fn().mockResolvedValue({ status: 'source_reading_not_found' })

    await expect(
      makeDurablePortalMetricRetractionHandler(options)({
        retractMetric: retract,
      })(event),
    ).rejects.toThrow('metric source reading is not available for retraction')
  })

  it('contains the same projection race on the best-effort event-bus path', async () => {
    const retract = vi.fn().mockResolvedValue({ status: 'source_reading_not_found' })

    await expect(
      makePortalMetricRetractionHandler(options)({ retractMetric: retract })(event),
    ).resolves.toBeUndefined()
  })
})
