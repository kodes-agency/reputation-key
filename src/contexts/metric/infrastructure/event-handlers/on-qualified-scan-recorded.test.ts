import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  portalAccessArtifactId,
  portalGroupId,
  portalId,
  propertyId,
  qualifiedScanId,
} from '#/shared/domain/ids'
import type { GuestQualifiedScanRecorded } from '#/contexts/guest/application/public-api'
import { onQualifiedScanRecordedDurably } from './on-qualified-scan-recorded'
import { onQualifiedScanRetractedDurably } from './on-qualified-scan-retracted'
import { createMockLogger } from '#/shared/testing/mock-logger'

const OCCURRED_AT = new Date('2026-08-27T10:00:00.000Z')
const GROUP_AT_EVENT_TIME = portalGroupId('71000000-0000-4000-8000-000000000004')
const STAFF_ATTRIBUTION = {
  staffParticipantId: '71000000-0000-4000-8000-000000000008',
  staffParticipationId: '71000000-0000-4000-8000-000000000009',
  portalResponsibilityId: '71000000-0000-4000-8000-000000000010',
  effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
  effectiveTo: null,
} as const
const event: GuestQualifiedScanRecorded = {
  _tag: 'guest.qualified_scan.recorded',
  eventId: '71000000-0000-4000-8000-000000000006',
  correlationId: null,
  qualifiedScanId: qualifiedScanId('71000000-0000-4000-8000-000000000005'),
  organizationId: organizationId('org-qualified-scan'),
  propertyId: propertyId('71000000-0000-4000-8000-000000000001'),
  portalId: portalId('71000000-0000-4000-8000-000000000002'),
  portalGroupId: GROUP_AT_EVENT_TIME,
  accessArtifactId: portalAccessArtifactId('71000000-0000-4000-8000-000000000003'),
  occurredAt: OCCURRED_AT,
  staffAttribution: STAFF_ATTRIBUTION,
}

describe('Qualified Scan metric projection', () => {
  it('uses producer-captured event-time group attribution during replay', async () => {
    const recordMetric = vi.fn().mockResolvedValue({ status: 'recorded' })
    const findGroupForPortal = vi.fn().mockResolvedValue({
      portalGroupId: portalGroupId('71000000-0000-4000-8000-000000000099'),
    })
    const handler = onQualifiedScanRecordedDurably({
      recordMetric,
      findGroupForPortal,
      logger: createMockLogger(),
    })

    await handler(event)
    await handler(event)

    expect(findGroupForPortal).not.toHaveBeenCalled()
    expect(recordMetric).toHaveBeenCalledTimes(2)
    expect(recordMetric).toHaveBeenNthCalledWith(1, {
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      portalId: event.portalId,
      portalGroupId: GROUP_AT_EVENT_TIME,
      definitionVersionId: '11111111-1111-4111-8111-111111111301',
      sourceEventId: event.eventId,
      sourcePolicy: 'first_party_guest_gateway_metric',
      scope: 'portal',
      value: 1,
      sampleCount: 1,
      occurredAt: OCCURRED_AT,
      attributionQuality: 'exact',
      staffAttribution: STAFF_ATTRIBUTION,
    })
    expect(recordMetric.mock.calls[1]).toEqual(recordMetric.mock.calls[0])
  })

  it('targets the original source fact with an append-only retraction', async () => {
    const retractMetric = vi.fn().mockResolvedValue({ status: 'retracted' })
    const correction = {
      ...event,
      _tag: 'guest.qualified_scan.retracted' as const,
      eventId: '71000000-0000-4000-8000-000000000007',
      supersedesSourceEventId: event.eventId,
      occurredAt: new Date('2026-08-27T11:00:00.000Z'),
    }

    await onQualifiedScanRetractedDurably({
      retractMetric,
      logger: createMockLogger(),
    })(correction)

    expect(retractMetric).toHaveBeenCalledWith({
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      portalId: event.portalId,
      definitionVersionId: '11111111-1111-4111-8111-111111111301',
      sourceEventId: correction.eventId,
      supersedesSourceEventId: event.eventId,
      occurredAt: correction.occurredAt,
      staffAttribution: STAFF_ATTRIBUTION,
    })
  })
})
