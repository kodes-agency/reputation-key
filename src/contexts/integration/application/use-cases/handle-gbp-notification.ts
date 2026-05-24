// Integration context — handle GBP notification use case
// Steps: lookup property by gbpPlaceId → validate connection → enqueue review sync job
// This is the business logic extracted from the webhook route.

import type { PropertyLookupPort } from '../ports/property-lookup.port'
import type { ReviewQueuePort } from '#/contexts/review/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type HandleGbpNotificationInput = Readonly<{
  locationId: string
  locationName: string
  messageId: string
}>

export type HandleGbpNotificationResult = Readonly<{
  enqueued: boolean
  propertyId?: string
  reason?: string
}>

export type HandleGbpNotificationDeps = Readonly<{
  propertyLookup: PropertyLookupPort
  reviewQueue: ReviewQueuePort
  logger: LoggerPort
}>

export const handleGbpNotification =
  (deps: HandleGbpNotificationDeps) =>
  async (input: HandleGbpNotificationInput): Promise<HandleGbpNotificationResult> => {
    const logger = deps.logger

    // 1. Resolve property by gbpPlaceId
    const property = await deps.propertyLookup.findByGbpPlaceId(input.locationId)

    if (!property || !property.googleConnectionId) {
      logger.info(
        { locationId: input.locationId },
        'Webhook notification for unknown or deleted property — ignoring',
      )
      return { enqueued: false, reason: 'property_not_found' }
    }

    // 2. Enqueue review sync job with messageId-based jobId for deduplication
    await deps.reviewQueue.addSyncJob(
      {
        propertyId: property.id,
        organizationId: property.organizationId,
        connectionId: property.googleConnectionId,
        locationName: input.locationName,
      },
      {
        jobId: `webhook:${input.messageId}`,
      },
    )

    logger.info(
      {
        propertyId: property.id,
        messageId: input.messageId,
      },
      'Webhook enqueued review sync',
    )

    return { enqueued: true, propertyId: property.id }
  }

export type HandleGbpNotification = ReturnType<typeof handleGbpNotification>
