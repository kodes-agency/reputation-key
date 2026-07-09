// Metric context — records portal.scan metric on scan events
import type { GuestScanRecorded } from '#/contexts/guest/application/public-api'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import type { OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnScanRecordedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
}>

export const onScanRecorded =
  (deps: OnScanRecordedDeps) =>
  async (event: GuestScanRecorded): Promise<void> => {
    return trace('metric.event.onScanRecorded', async () => {
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
          metricKey: 'portal.scan',
          value: 1,
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
          'metric: failed to record portal.scan',
        )
      }
    })
  }
