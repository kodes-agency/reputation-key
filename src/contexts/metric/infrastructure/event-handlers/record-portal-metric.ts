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
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

/** Common shape of the guest events that record a portal metric. */
export type PortalMetricEvent = Readonly<{
  _tag: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  eventId: string
  occurredAt: Date
}>

export type RecordPortalMetricDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
    asOf: Date,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
}>

export function makeRecordMetricHandler<E extends PortalMetricEvent>(opts: {
  metricKey: MetricKey
  definitionVersionId: string
  sourcePolicy: SourcePolicyClass
  span: string
  value?: (event: E) => number
}) {
  return (deps: RecordPortalMetricDeps) =>
    async (event: E): Promise<void> => {
      return trace(opts.span, async () => {
        try {
          let portalGroupId: PortalGroupId | null = null
          let attributionQuality: AttributionQuality = 'exact'
          if (event.portalId) {
            try {
              portalGroupId =
                (
                  await deps.findGroupForPortal(
                    event.organizationId,
                    event.portalId,
                    event.occurredAt,
                  )
                )?.portalGroupId ?? null
            } catch {
              attributionQuality = 'unresolved'
            }
          }
          await deps.recordMetric({
            organizationId: event.organizationId,
            propertyId: event.propertyId,
            portalId: event.portalId,
            portalGroupId,
            definitionVersionId: opts.definitionVersionId,
            sourceEventId: event.eventId,
            sourcePolicy: opts.sourcePolicy,
            scope: 'portal',
            value: opts.value ? opts.value(event) : 1,
            sampleCount: 1,
            occurredAt: event.occurredAt,
            attributionQuality,
          })
        } catch (err) {
          getLogger().error(
            {
              err,
              event: event._tag,
            },
            `metric: failed to record ${opts.metricKey}`,
          )
        }
      })
    }
}
