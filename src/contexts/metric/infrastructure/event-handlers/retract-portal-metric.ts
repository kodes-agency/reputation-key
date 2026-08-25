import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { RetractMetric } from '../../application/use-cases/retract-metric'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type PortalMetricRetractionEvent = Readonly<{
  _tag: string
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  supersedesSourceEventId: string
  occurredAt: Date
}>

export type RetractPortalMetricDeps = Readonly<{
  retractMetric: RetractMetric
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
          getLogger().error(
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
