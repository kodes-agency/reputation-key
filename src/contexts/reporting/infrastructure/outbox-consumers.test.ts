import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod/v4'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import { METRIC_VERSION_IDS } from '../domain/metric-registry'
import type { RecordMetricInput } from '../application/use-cases/record-metric'
import {
  onApprovedDestinationRatioRecorded,
  onConfigurationCompletenessRecorded,
  onContentReviewCompleted,
  registerPortalWorkflowMetricConsumers,
  type PortalMetricAttribution,
} from './outbox-consumers'

const occurredAt = new Date('2026-08-09T12:00:00.000Z')
const orgId = organizationId('org-1')
const propId = propertyId('11111111-1111-4111-8111-111111111111')
const pid = portalId('22222222-2222-4222-8222-222222222222')
const groupId = portalGroupId('33333333-3333-4333-8333-333333333333')

/** Source events that already have a reading, by the version they were recorded under. */
type RecordedReadings = Readonly<Record<string, readonly string[]>>

function makeDeps(
  attribution: PortalMetricAttribution | null = {
    propertyId: propId,
    portalGroupId: groupId,
  },
  recorded: RecordedReadings = {},
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
    hasReading: vi.fn(
      async (query: { definitionVersionId: string; sourceEventId: string }) =>
        (recorded[query.definitionVersionId] ?? []).includes(query.sourceEventId),
    ),
  }
}

const common = {
  correlationId: null,
  organizationId: orgId,
  propertyId: propId,
  portalId: pid,
  portalGroupId: groupId,
  sourceAggregateVersion: '2026-08-09T13:00:00.001Z',
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
      fieldSet: 'immersive_hub',
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
      METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
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
    expect(deps.readings.map((reading) => reading.sourceReceipt)).toEqual([
      {
        eventId: 'review-event',
        consumerName: 'metric.portal-workflow',
      },
      {
        eventId: 'completeness-event',
        consumerName: 'metric.portal-workflow',
      },
      {
        eventId: 'ratio-event',
        consumerName: 'metric.portal-workflow',
      },
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
      fieldSet: 'immersive_hub',
    })

    expect(deps.readings[0]).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
      sourceEventId: 'correction-event',
      supersedesSourceEventId: 'original-event',
      value: 100,
    })
    expect(deps.hasReading).toHaveBeenCalledWith({
      organizationId: orgId,
      definitionVersionId: METRIC_VERSION_IDS.configurationCompleteness,
      sourceEventId: 'original-event',
    })
  })

  it('keeps a fact counted on the legacy fields under the legacy version', async () => {
    const deps = makeDeps(undefined, {
      [METRIC_VERSION_IDS.configurationCompleteness]: ['legacy-original-event'],
    })

    await onConfigurationCompletenessRecorded(deps)({
      ...common,
      _tag: 'portal.configuration_completeness.recorded',
      eventId: 'legacy-event',
      reviewId: 'review-cycle-1',
      revision: 2,
      supersedesSourceEventId: 'legacy-original-event',
      completedFields: 3,
      requiredFields: 5,
      fieldSet: 'legacy',
    })

    expect(deps.readings[0]).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.configurationCompleteness,
      supersedesSourceEventId: 'legacy-original-event',
      value: 60,
    })
  })

  it('starts the Immersive Hub series when it corrects a review counted on the legacy fields', async () => {
    const deps = makeDeps(undefined, {
      [METRIC_VERSION_IDS.configurationCompleteness]: ['legacy-original-event'],
    })

    await onConfigurationCompletenessRecorded(deps)({
      ...common,
      _tag: 'portal.configuration_completeness.recorded',
      eventId: 'cross-version-correction',
      reviewId: 'review-cycle-1',
      revision: 2,
      supersedesSourceEventId: 'legacy-original-event',
      completedFields: 5,
      requiredFields: 5,
      fieldSet: 'immersive_hub',
    })

    expect(deps.readings[0]).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
      sourceEventId: 'cross-version-correction',
      supersedesSourceEventId: null,
      value: 100,
    })
  })

  it('records a legacy correction of an Immersive Hub reading as a fresh legacy reading', async () => {
    // Only a web instance still on the legacy count, during a deploy, can send one.
    const deps = makeDeps(undefined, {
      [METRIC_VERSION_IDS.configurationCompletenessImmersiveHub]: ['immersive-event'],
    })

    await onConfigurationCompletenessRecorded(deps)({
      ...common,
      _tag: 'portal.configuration_completeness.recorded',
      eventId: 'late-legacy-correction',
      reviewId: 'review-cycle-1',
      revision: 2,
      supersedesSourceEventId: 'immersive-event',
      completedFields: 4,
      requiredFields: 5,
      fieldSet: 'legacy',
    })

    expect(deps.readings[0]).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.configurationCompleteness,
      supersedesSourceEventId: null,
    })
    expect(deps.hasReading).toHaveBeenCalledWith({
      organizationId: orgId,
      definitionVersionId: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
      sourceEventId: 'immersive-event',
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

  it('propagates a failed attribution lookup so durable delivery retries the fact', async () => {
    const lookupFailure = new Error('portal attribution lookup unavailable')
    const deps = {
      ...makeDeps(),
      resolveAttribution: vi.fn().mockRejectedValue(lookupFailure),
    }

    await expect(
      onContentReviewCompleted(deps)({
        ...common,
        _tag: 'portal.content_review.completed',
        eventId: 'lookup-failure-event',
        reviewId: 'review-cycle-1',
        revision: 1,
      }),
    ).rejects.toBe(lookupFailure)
    expect(deps.recordMetric).not.toHaveBeenCalled()
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

describe('Portal configuration completeness delivery', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })

  function completenessHandler(deps: ReturnType<typeof makeDeps>) {
    const registry = createConsumerRegistry()
    registerPortalWorkflowMetricConsumers(registry, deps)
    const [consumer] = registry.listFor('portal.configuration_completeness.recorded')
    if (!consumer) throw new Error('completeness consumer was not registered')
    return consumer.handler
  }

  const envelope = (eventVersion: number, payload: Record<string, unknown>) => ({
    eventId: `completeness-v${eventVersion}`,
    eventType: 'portal.configuration_completeness.recorded',
    eventVersion,
    payload: {
      reviewId: 'review-cycle-1',
      revision: 1,
      organizationId: orgId,
      propertyId: propId,
      portalId: pid,
      portalGroupId: groupId,
      supersedesSourceEventId: null,
      sourceAggregateVersion: '2026-08-09T13:00:00.001Z',
      occurredAt: occurredAt.toISOString(),
      completedFields: 4,
      requiredFields: 5,
      ...payload,
    },
    organizationId: orgId,
    propertyId: propId,
    sourceContext: 'portal',
    sourceAggregateId: 'review-cycle-1',
  })

  it('reads a fact stored before the field set existed as a legacy count', async () => {
    const deps = makeDeps()

    await expect(completenessHandler(deps)(envelope(2, {}))).resolves.toEqual({
      status: 'applied',
    })

    expect(deps.readings).toEqual([
      expect.objectContaining({
        definitionVersionId: METRIC_VERSION_IDS.configurationCompleteness,
        numerator: 4,
        denominator: 5,
      }),
    ])
  })

  it('reads a v3 fact under the version of the fields it names', async () => {
    const deps = makeDeps()

    await completenessHandler(deps)(envelope(3, { fieldSet: 'immersive_hub' }))

    expect(deps.readings).toEqual([
      expect.objectContaining({
        definitionVersionId: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
        numerator: 4,
        denominator: 5,
      }),
    ])
  })

  it('refuses a v3 fact that does not name its fields', async () => {
    const deps = makeDeps()

    await expect(completenessHandler(deps)(envelope(3, {}))).rejects.toBeInstanceOf(
      ZodError,
    )
    expect(deps.recordMetric).not.toHaveBeenCalled()
  })
})
