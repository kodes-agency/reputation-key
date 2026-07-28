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
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

/** Common shape of the guest events that record a portal metric. */
export type PortalMetricEvent = Readonly<{
  _tag: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
}>

export type RecordPortalMetricDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
}>

export function makeRecordMetricHandler<E extends PortalMetricEvent>(opts: {
  metricKey: MetricKey
  span: string
  value?: (event: E) => number
}) {
  return (deps: RecordPortalMetricDeps) =>
    async (event: E): Promise<void> => {
      return trace(opts.span, async () => {
        try {
          let groupId: PortalGroupId | null = null
          if (event.portalId) {
            // Group resolution failure must not block metric recording —
            // degrade to groupId: null so the reading still lands for
            // portal-scoped (non-group) badges/leaderboards.
            try {
              groupId =
                (await deps.findGroupForPortal(event.organizationId, event.portalId))
                  ?.portalGroupId ?? null
            } catch {
              // swallowed — groupId stays null
            }
          }
          await deps.recordMetric({
            organizationId: event.organizationId,
            propertyId: event.propertyId,
            portalId: event.portalId,
            metricKey: opts.metricKey,
            value: opts.value ? opts.value(event) : 1,
            groupId,
          })
        } catch (err) {
          getLogger().error(
            {
              err,
              event: event._tag,
              portalId: event.portalId,
              organizationId: event.organizationId,
            },
            `metric: failed to record ${opts.metricKey}`,
          )
        }
      })
    }
}
