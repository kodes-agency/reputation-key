// Metric context — records portal.feedback metric on feedback submission events
import type { GuestFeedbackSubmitted } from '#/contexts/guest/application/public-api'
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
import type { OrganizationId, PortalId, PortalGroupId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnFeedbackSubmittedDeps = Readonly<{
  recordMetric(input: RecordMetricInput): Promise<unknown>
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
}>

export const onFeedbackSubmitted =
  (deps: OnFeedbackSubmittedDeps) =>
  async (event: GuestFeedbackSubmitted): Promise<void> => {
    return trace('metric.event.onFeedbackSubmitted', async () => {
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
          metricKey: 'portal.feedback',
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
          'metric: failed to record portal.feedback',
        )
      }
    })
  }
