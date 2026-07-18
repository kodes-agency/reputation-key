import type { PropertyCreated } from '#/contexts/property/application/public-api'
import { isRegionProcessable } from '#/contexts/property/domain/processing-routing'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnPropertyCreatedDeps = Readonly<{
  queue: ReviewQueuePort
}>

export const onPropertyCreated =
  (deps: OnPropertyCreatedDeps) =>
  async (event: PropertyCreated): Promise<void> => {
    return trace('event.onPropertyCreated', async () => {
      if (!event.gbpLocationName || !event.googleConnectionId) return

      const logger = getLogger()

      // BQC-4.1 / ADR 0048: defense in depth — never enqueue an initial sync
      // for a property outside the approved cell (syncReviews would refuse
      // anyway; skipping here keeps a known-dead job out of the queue).
      // A missing region field predates the gate — the emitter's own gate is
      // trusted in that case.
      if (
        event.processingRegion !== undefined &&
        !isRegionProcessable(event.processingRegion)
      ) {
        logger.info(
          { propertyId: event.propertyId, processingRegion: event.processingRegion },
          'property.created: initial review sync blocked — region not processable',
        )
        return
      }

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
    })
  }
