import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import {
  integrationGoogleReviewPushAccepted,
  type GoogleReviewPushNotificationKind,
} from '../../domain/events'
import type { GbpReviewPushReceiptStore } from '../ports/gbp-review-push-receipt.port'
import type { GoogleReviewPushReferenceStore } from '../ports/google-review-push-reference.port'
import type { PropertyLookupPort } from '../ports/property-lookup.port'

export type HandleGbpNotificationInput = Readonly<{
  topic: string
  messageId: string
  notificationKind: GoogleReviewPushNotificationKind
  locationId: string
  locationName: string
  reviewName: string
}>

export type HandleGbpNotificationResult = Readonly<{
  accepted: true
  duplicate: boolean
  handoff: 'targeted' | 'reconciliation' | 'ignored'
  propertyId?: string
}>

export type HandleGbpNotificationDeps = Readonly<{
  propertyLookup: PropertyLookupPort
  references: GoogleReviewPushReferenceStore
  receipts: GbpReviewPushReceiptStore
  clock: () => Date
  logger: LoggerPort
}>

function exactProviderTarget(input: HandleGbpNotificationInput) {
  const resource = parseReviewProviderResource(input.reviewName)
  const canonicalLocation = `accounts/${resource.accountId}/locations/${resource.locationId}`
  if (
    canonicalLocation !== input.locationName ||
    resource.locationId !== input.locationId
  ) {
    throw new TypeError('Google review push resource mismatch')
  }
  return resource
}

export const handleGbpNotification =
  (deps: HandleGbpNotificationDeps) =>
  async (input: HandleGbpNotificationInput): Promise<HandleGbpNotificationResult> => {
    const receivedAt = deps.clock()
    const resource = exactProviderTarget(input)
    const property = await deps.propertyLookup.findByGbpLocationId(input.locationId)

    if (!property) {
      const receipt = await deps.receipts.record({
        topic: input.topic,
        messageId: input.messageId,
        receivedAt,
        acceptedAt: deps.clock(),
        notificationKind: input.notificationKind,
        resolvedPropertyId: null,
        outcome: 'ignored_property_not_found',
        event: null,
      })
      deps.logger.info(
        { duplicate: receipt.status === 'duplicate' },
        'GBP review push accepted for an unimported location',
      )
      return {
        accepted: true,
        duplicate: receipt.status === 'duplicate',
        handoff: 'ignored',
      }
    }

    const exactBinding =
      property.googleBindingState === 'active' &&
      property.googleConnectionId !== null &&
      property.gbpAccountId === resource.accountId &&
      property.gbpLocationId === resource.locationId &&
      Number.isSafeInteger(property.sourceEpoch) &&
      property.sourceEpoch >= 0
    if (!exactBinding) {
      const receipt = await deps.receipts.record({
        topic: input.topic,
        messageId: input.messageId,
        receivedAt,
        acceptedAt: deps.clock(),
        notificationKind: input.notificationKind,
        resolvedPropertyId: property.id,
        outcome: 'ignored_binding_mismatch',
        event: null,
      })
      deps.logger.warn(
        { duplicate: receipt.status === 'duplicate' },
        'GBP review push did not match the current Property binding',
      )
      return {
        accepted: true,
        duplicate: receipt.status === 'duplicate',
        handoff: 'ignored',
      }
    }

    const scope = {
      organizationId: property.organizationId,
      propertyId: property.id,
      connectionId: property.googleConnectionId!,
      sourceEpoch: property.sourceEpoch,
    }
    const published = await deps.references.publish({
      scope,
      locationName: input.locationName,
      reviewName: input.reviewName,
    })
    const referenceRef = published.ok ? published.referenceRef : null
    const handoff = published.ok ? 'targeted' : 'reconciliation'
    const occurredAt = deps.clock()
    const event = integrationGoogleReviewPushAccepted({
      organizationId: organizationId(property.organizationId),
      propertyId: property.id,
      connectionId: googleConnectionId(property.googleConnectionId!),
      sourceEpoch: property.sourceEpoch,
      referenceRef,
      notificationKind: input.notificationKind,
      occurredAt,
    })
    const receipt = await deps.receipts.record({
      topic: input.topic,
      messageId: input.messageId,
      receivedAt,
      acceptedAt: occurredAt,
      notificationKind: input.notificationKind,
      resolvedPropertyId: property.id,
      outcome: published.ok ? 'accepted_targeted' : 'accepted_reconciliation',
      event,
    })
    deps.logger.info(
      {
        duplicate: receipt.status === 'duplicate',
        handoff,
      },
      'GBP review push durably accepted',
    )
    return {
      accepted: true,
      duplicate: receipt.status === 'duplicate',
      handoff,
      propertyId: property.id,
    }
  }

export type HandleGbpNotification = ReturnType<typeof handleGbpNotification>
