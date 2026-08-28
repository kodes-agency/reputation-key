import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { RetractMetric } from '../../application/use-cases/retract-metric'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'

export type PortalMetricRetractionEvent = Readonly<{
  _tag: string
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  supersedesSourceEventId: string
  occurredAt: Date
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
}>

export type RetractPortalMetricDeps = Readonly<{
  retractMetric: RetractMetric
  logger: Pick<LoggerPort, 'error'>
}>

type RetractionOption = Readonly<{
  definitionVersionId: string
  span: string
}>

async function retractPortalMetrics(
  options: readonly RetractionOption[],
  deps: RetractPortalMetricDeps,
  event: PortalMetricRetractionEvent,
): Promise<void> {
  for (const option of options) {
    const result = await deps.retractMetric({
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      portalId: event.portalId,
      definitionVersionId: option.definitionVersionId,
      sourceEventId: event.eventId,
      supersedesSourceEventId: event.supersedesSourceEventId,
      occurredAt: event.occurredAt,
      staffAttribution: event.staffAttribution ?? null,
    })
    if (result.status === 'source_reading_not_found') {
      // Durable delivery may race the original projection. Throwing leaves the
      // receipt retryable instead of accepting a permanently stale aggregate.
      throw new Error('metric source reading is not available for retraction')
    }
  }
}

export function makePortalMetricRetractionHandler<E extends PortalMetricRetractionEvent>(
  options: readonly RetractionOption[],
) {
  return (deps: RetractPortalMetricDeps) =>
    async (event: E): Promise<void> =>
      trace(options[0]?.span ?? 'metric.event.portalMetricRetraction', async () => {
        try {
          await retractPortalMetrics(options, deps, event)
        } catch (err) {
          deps.logger.error(
            { err, event: event._tag },
            'metric: failed to retract Portal metric',
          )
        }
      })
}

export function makeDurablePortalMetricRetractionHandler<
  E extends PortalMetricRetractionEvent,
>(options: readonly RetractionOption[]) {
  return (deps: RetractPortalMetricDeps) =>
    async (event: E): Promise<void> =>
      trace(`${options[0]?.span ?? 'metric.event.portalMetricRetraction'}.durable`, () =>
        retractPortalMetrics(options, deps, event),
      )
}
