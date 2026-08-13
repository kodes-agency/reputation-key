import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import {
  onApprovedDestinationRatioRecorded,
  onConfigurationCompletenessRecorded,
  onContentReviewCompleted,
  type PortalMetricAttribution,
} from './on-portal-workflow-metric'

const occurredAt = new Date('2026-08-09T12:00:00.000Z')
const orgId = organizationId('org-1')
const propId = propertyId('11111111-1111-4111-8111-111111111111')
const pid = portalId('22222222-2222-4222-8222-222222222222')
const groupId = portalGroupId('33333333-3333-4333-8333-333333333333')

function makeDeps(
  attribution: PortalMetricAttribution | null = {
    propertyId: propId,
    portalGroupId: groupId,
  },
) {
  const readings: RecordMetricInput[] = []
  const recordMetric = vi.fn(async (input: RecordMetricInput) => {
    readings.push(input)
    return {
      status: 'duplicate' as const,
      existingReadingId: `${input.definitionVersionId}:${input.sourceEventId}`,
    }
  })
  return {
    readings,
    recordMetric,
    resolveAttribution: vi.fn(async () => attribution),
  }
}

const common = {
  correlationId: null,
  organizationId: orgId,
  propertyId: propId,
  portalId: pid,
  portalGroupId: groupId,
  occurredAt,
  supersedesSourceEventId: null,
}

describe('Portal governed workflow metric handlers', () => {
  it('records all three beta-safe immutable definition versions from exact facts', async () => {
    const deps = makeDeps()

    await onContentReviewCompleted(deps)({
      ...common,
      _tag: 'portal.content_review.completed',
      eventId: 'review-event',
      reviewId: 'review-cycle-1',
      revision: 1,
    })
    await onConfigurationCompletenessRecorded(deps)({
      ...common,
      _tag: 'portal.configuration_completeness.recorded',
      eventId: 'completeness-event',
      reviewId: 'review-cycle-1',
      revision: 1,
      completedFields: 4,
      requiredFields: 5,
    })
    await onApprovedDestinationRatioRecorded(deps)({
      ...common,
      _tag: 'portal.approved_destination_ratio.recorded',
      eventId: 'ratio-event',
      reviewId: 'review-cycle-1',
      revision: 1,
      approvedDestinations: 4,
      configuredDestinations: 5,
    })

    expect(deps.readings.map((reading) => reading.definitionVersionId)).toEqual([
      METRIC_VERSION_IDS.contentReviewCompleted,
      METRIC_VERSION_IDS.configurationCompleteness,
      METRIC_VERSION_IDS.approvedDestinationRatio,
    ])
    expect(deps.readings).toEqual([
      expect.objectContaining({
        sourceEventId: 'review-event',
        sourcePolicy: 'first_party_workflow',
        scope: 'portal_group',
        value: 1,
        sampleCount: 1,
        attributionQuality: 'exact',
      }),
      expect.objectContaining({
        sourceEventId: 'completeness-event',
        value: 80,
        numerator: 4,
        denominator: 5,
        sampleCount: 5,
      }),
      expect.objectContaining({
        sourceEventId: 'ratio-event',
        value: 0.8,
        numerator: 4,
        denominator: 5,
        sampleCount: 5,
      }),
    ])
  })

  it('uses the stable event ID so replay reaches recordMetric idempotency', async () => {
    const deps = makeDeps()
    const event = {
      ...common,
      _tag: 'portal.content_review.completed' as const,
      eventId: 'stable-review-event',
      reviewId: 'review-cycle-1',
      revision: 1,
    }
    const handler = onContentReviewCompleted(deps)

    await handler(event)
    await handler(event)

    expect(deps.recordMetric).toHaveBeenCalledTimes(2)
    expect(deps.readings.map((reading) => reading.sourceEventId)).toEqual([
      'stable-review-event',
      'stable-review-event',
    ])
  })

  it('carries correction lineage so the command store can retract the superseded fact', async () => {
    const deps = makeDeps()

    await onConfigurationCompletenessRecorded(deps)({
      ...common,
      _tag: 'portal.configuration_completeness.recorded',
      eventId: 'correction-event',
      reviewId: 'review-cycle-1',
      revision: 2,
      supersedesSourceEventId: 'original-event',
      completedFields: 5,
      requiredFields: 5,
    })

    expect(deps.readings[0]).toMatchObject({
      sourceEventId: 'correction-event',
      supersedesSourceEventId: 'original-event',
      value: 100,
    })
  })

  it('marks cross-tenant/property/group attribution as unresolved for quarantine', async () => {
    const deps = makeDeps({
      propertyId: propertyId('44444444-4444-4444-8444-444444444444'),
      portalGroupId: groupId,
    })

    await onContentReviewCompleted(deps)({
      ...common,
      _tag: 'portal.content_review.completed',
      eventId: 'bad-attribution-event',
      reviewId: 'review-cycle-1',
      revision: 1,
    })

    expect(deps.readings[0]).toMatchObject({ attributionQuality: 'unresolved' })
  })

  it('passes an insufficient destination sample without converting it to zero', async () => {
    const deps = makeDeps()

    await onApprovedDestinationRatioRecorded(deps)({
      ...common,
      _tag: 'portal.approved_destination_ratio.recorded',
      eventId: 'small-sample-event',
      reviewId: 'review-cycle-1',
      revision: 1,
      approvedDestinations: 3,
      configuredDestinations: 4,
    })

    expect(deps.readings[0]).toMatchObject({
      value: 0.75,
      numerator: 3,
      denominator: 4,
      sampleCount: 4,
    })
  })
})
