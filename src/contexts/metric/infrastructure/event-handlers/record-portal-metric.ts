// Metric context — portal-metric event handler factory (BQC-5.9 E8).
//
// Single source for the guest-event → metric_reading wrapper: trace span,
// group resolution with degradation (a findGroupForPortal failure must not
// block metric recording — degrade to groupId: null so the reading still
// lands for portal-scoped badges/leaderboards), and the failure-isolated
// try/catch that logs instead of propagating. The 4 portal-metric handlers
// are one-liners over this factory.

import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import type {
  OrganizationId,
  PortalId,
  PortalGroupId,
  PropertyId,
} from '#/shared/domain/ids'
import type { MetricKey } from '#/shared/domain/metric-keys'
import type { SourcePolicyClass } from '../../domain/metric-registry'
import type { AttributionQuality } from '../../domain/attribution-quality'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'
import type { PortalDestinationKind } from '../../domain/portal-lifetime-aggregate'
import type { ReadingResult } from '../../domain/metric-reading'

/** Common shape of the guest events that record a portal metric. */
export type PortalMetricEvent = Readonly<{
  _tag: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  eventId: string
  supersedesSourceEventId?: string | null
  occurredAt: Date
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
}>

export type RecordPortalMetricDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<ReadingResult>
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
    asOf: Date,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
  logger: Pick<LoggerPort, 'error' | 'warn'>
}>

export type PortalMetricHandlerOptions<E extends PortalMetricEvent> = Readonly<{
  metricKey: MetricKey
  definitionVersionId: string
  sourcePolicy: SourcePolicyClass
  span: string
  value?: (event: E) => number
  /** Producer-owned event-time attribution. When present, it must not be
   * recomputed from current Portal membership during replay. */
  portalGroupId?: (event: E) => PortalGroupId | null
  destinationKind?: (event: E) => PortalDestinationKind
}>

async function recordPortalMetrics<E extends PortalMetricEvent>(
  options: readonly PortalMetricHandlerOptions<E>[],
  deps: RecordPortalMetricDeps,
  event: E,
): Promise<void> {
  let portalGroupId: PortalGroupId | null = null
  // Portal facts carry portalId on the event itself, so tenant/portal
  // attribution is exact; portal-group membership is a downstream
  // ENRICHMENT, not the attribution. 'unresolved' stays reserved for
  // producers whose attribution really is unknown — record-metric.ts
  // quarantines that value before the reading is constructed.
  const attributionQuality: AttributionQuality = 'exact'
  const capturedGroup = options[0]?.portalGroupId
  if (capturedGroup) {
    portalGroupId = capturedGroup(event)
  } else if (event.portalId) {
    try {
      portalGroupId =
        (
          await deps.findGroupForPortal(
            event.organizationId,
            event.portalId,
            event.occurredAt,
          )
        )?.portalGroupId ?? null
    } catch (err) {
      // A group-enrichment outage must not discard an exact portal reading.
      // The durable consumer still propagates failures from recordMetric.
      deps.logger.warn(
        { err, event: event._tag, metricKeys: options.map((item) => item.metricKey) },
        'metric: portal-group lookup failed — recording Portal metrics with a null group',
      )
    }
  }
  for (const opts of options) {
    const result = await deps.recordMetric({
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      portalId: event.portalId,
      portalGroupId,
      definitionVersionId: opts.definitionVersionId,
      sourceEventId: event.eventId,
      ...(event.supersedesSourceEventId
        ? { supersedesSourceEventId: event.supersedesSourceEventId }
        : {}),
      sourcePolicy: opts.sourcePolicy,
      scope: 'portal',
      value: opts.value ? opts.value(event) : 1,
      sampleCount: 1,
      occurredAt: event.occurredAt,
      attributionQuality,
      staffAttribution: event.staffAttribution ?? null,
      ...(opts.destinationKind ? { destinationKind: opts.destinationKind(event) } : {}),
    })
    if (
      result.status === 'quarantined' &&
      result.reason === 'superseded_reading_not_found'
    ) {
      // The durable source correction raced its original projection. Keeping
      // the delivery retryable lets the ordered state converge; accepting the
      // receipt here would strand a permanent quarantine and stale totals.
      throw new Error('superseded metric source reading is not available')
    }
  }
}

export function makeRecordMetricHandler<E extends PortalMetricEvent>(
  opts: PortalMetricHandlerOptions<E>,
) {
  return makeRecordMetricFanoutHandler([opts])
}

export function makeRecordMetricFanoutHandler<E extends PortalMetricEvent>(
  options: readonly PortalMetricHandlerOptions<E>[],
) {
  return (deps: RecordPortalMetricDeps) =>
    async (event: E): Promise<void> => {
      return trace(options[0]?.span ?? 'metric.event.portalMetricFanout', async () => {
        try {
          await recordPortalMetrics(options, deps, event)
        } catch (err) {
          deps.logger.error(
            {
              err,
              event: event._tag,
            },
            'metric: failed to record Portal metric fanout',
          )
        }
      })
    }
}

/**
 * Durable counterpart to the in-process handler. Unlike the bus adapter it
 * deliberately does not catch persistence failures: the outbox dispatcher
 * must fail the job so BullMQ can retry it. Both paths converge on the metric
 * command store's source-event idempotency.
 */
export function makeDurableRecordMetricHandler<E extends PortalMetricEvent>(
  opts: PortalMetricHandlerOptions<E>,
) {
  return makeDurableRecordMetricFanoutHandler([opts])
}

export function makeDurableRecordMetricFanoutHandler<E extends PortalMetricEvent>(
  options: readonly PortalMetricHandlerOptions<E>[],
) {
  return (deps: RecordPortalMetricDeps) =>
    async (event: E): Promise<void> =>
      trace(`${options[0]?.span ?? 'metric.event.portalMetricFanout'}.durable`, () =>
        recordPortalMetrics(options, deps, event),
      )
}
