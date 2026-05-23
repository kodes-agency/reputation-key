import type { PropertyCreated } from '#/contexts/property/application/public-api'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import { getLogger } from '#/shared/observability/logger'

export type OnPropertyCreatedDeps = Readonly<{
  queue: ReviewQueuePort
}>

export const onPropertyCreated =
  (deps: OnPropertyCreatedDeps) =>
  async (event: PropertyCreated): Promise<void> => {
    if (!event.gbpLocationName || !event.googleConnectionId) return

    const logger = getLogger()
    logger.info(
      { propertyId: event.propertyId, gbpLocationName: event.gbpLocationName },
      'property.created: enqueuing initial review sync',
    )

    try {
      await deps.queue.addSyncJob({
        propertyId: event.propertyId,
        organizationId: event.organizationId,
        connectionId: event.googleConnectionId,
        locationName: event.gbpLocationName,
      })
    } catch (err) {
      logger.error(
        { err, propertyId: event.propertyId },
        'property.created: failed to enqueue review sync',
      )
    }
  }
