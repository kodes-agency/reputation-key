import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import {
  integrationGoogleReviewPushAccepted,
  type GoogleReviewPushNotificationKind,
} from '../../domain/events'
import type {
  GbpReviewPushDelivery,
  GbpReviewPushReceiptStore,
} from '../ports/gbp-review-push-receipt.port'
import type { GoogleReviewPushReferenceStore } from '../ports/google-review-push-reference.port'

export type PropertyLookup = Readonly<{
  id: string
  organizationId: string
  googleConnectionId: string | null
  gbpAccountId: string | null
  gbpLocationId: string | null
  googleBindingState:
    'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
  sourceEpoch: number
}>

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
  /** `reconciliation` when any Property's handoff fell back to a full sync. */
  handoff: 'targeted' | 'reconciliation' | 'ignored'
  /** Every Property the push was handed to; empty when it was ignored. */
  propertyIds: ReadonlyArray<string>
}>

export type HandleGbpNotificationDeps = Readonly<{
  propertyLookup: Pick<PropertyPublicApi, 'listByGbpLocationId'>
  references: GoogleReviewPushReferenceStore
  receipts: GbpReviewPushReceiptStore
  clock: () => Date
  logger: LoggerPort
}>

type ProviderTarget = ReturnType<typeof parseReviewProviderResource>
type BoundProperty = PropertyLookup & Readonly<{ googleConnectionId: string }>

function exactProviderTarget(input: HandleGbpNotificationInput): ProviderTarget {
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

/** The push is for this Property: its current binding is the account and location named. */
const isBoundTo =
  (resource: ProviderTarget) =>
  (property: PropertyLookup): property is BoundProperty =>
    property.googleBindingState === 'active' &&
    property.googleConnectionId !== null &&
    property.gbpAccountId === resource.accountId &&
    property.gbpLocationId === resource.locationId &&
    Number.isSafeInteger(property.sourceEpoch) &&
    property.sourceEpoch >= 0

export const handleGbpNotification = (deps: HandleGbpNotificationDeps) => {
  const ignore = async (
    input: HandleGbpNotificationInput,
    receivedAt: Date,
    delivery: GbpReviewPushDelivery,
  ): Promise<HandleGbpNotificationResult> => {
    const receipt = await deps.receipts.record({
      topic: input.topic,
      messageId: input.messageId,
      receivedAt,
      acceptedAt: deps.clock(),
      notificationKind: input.notificationKind,
      deliveries: [delivery],
    })
    return {
      accepted: true,
      duplicate: receipt.status === 'duplicate',
      handoff: 'ignored',
      propertyIds: [],
    }
  }

  /** Publish the short-lived reference one Property's targeted fetch will resolve. */
  const publishReference = async (
    input: HandleGbpNotificationInput,
    property: BoundProperty,
  ) => {
    const published = await deps.references.publish({
      scope: {
        organizationId: property.organizationId,
        propertyId: property.id,
        connectionId: property.googleConnectionId,
        sourceEpoch: property.sourceEpoch,
      },
      locationName: input.locationName,
      reviewName: input.reviewName,
    })
    return { property, referenceRef: published.ok ? published.referenceRef : null }
  }

  /** One Property's receipt and handoff fact, under its own Organization. */
  const deliveryAt =
    (input: HandleGbpNotificationInput, occurredAt: Date) =>
    ({
      property,
      referenceRef,
    }: Awaited<ReturnType<typeof publishReference>>): GbpReviewPushDelivery => ({
      resolvedPropertyId: property.id,
      outcome: referenceRef === null ? 'accepted_reconciliation' : 'accepted_targeted',
      event: integrationGoogleReviewPushAccepted({
        organizationId: organizationId(property.organizationId),
        propertyId: property.id,
        connectionId: googleConnectionId(property.googleConnectionId),
        sourceEpoch: property.sourceEpoch,
        referenceRef,
        notificationKind: input.notificationKind,
        occurredAt,
      }),
    })

  return async (
    input: HandleGbpNotificationInput,
  ): Promise<HandleGbpNotificationResult> => {
    const receivedAt = deps.clock()
    const resource = exactProviderTarget(input)
    // A location is unique only within an Organization: every Property that
    // holds it is a candidate, and the push is for each one whose binding is
    // the account it names. Picking a single row here would hand the push to
    // one Organization and silently drop it for the others.
    const holders = await deps.propertyLookup.listByGbpLocationId(input.locationId)
    const [firstHolder] = holders

    if (!firstHolder) {
      const ignored = await ignore(input, receivedAt, {
        resolvedPropertyId: null,
        outcome: 'ignored_property_not_found',
        event: null,
      })
      deps.logger.info(
        { duplicate: ignored.duplicate },
        'GBP review push accepted for an unimported location',
      )
      return ignored
    }

    const [firstBound, ...furtherBound] = holders.filter(isBoundTo(resource))
    if (!firstBound) {
      const ignored = await ignore(input, receivedAt, {
        resolvedPropertyId: firstHolder.id,
        outcome: 'ignored_binding_mismatch',
        event: null,
      })
      deps.logger.warn(
        { duplicate: ignored.duplicate },
        'GBP review push did not match the current Property binding',
      )
      return ignored
    }

    // Each Property is handed the push under its own Organization, connection
    // and source epoch; nothing of one tenant reaches another.
    const firstReference = await publishReference(input, firstBound)
    const furtherReferences = []
    for (const property of furtherBound) {
      furtherReferences.push(await publishReference(input, property))
    }
    const references = [firstReference, ...furtherReferences]
    const occurredAt = deps.clock()
    const delivery = deliveryAt(input, occurredAt)
    const receipt = await deps.receipts.record({
      topic: input.topic,
      messageId: input.messageId,
      receivedAt,
      acceptedAt: occurredAt,
      notificationKind: input.notificationKind,
      deliveries: [delivery(firstReference), ...furtherReferences.map(delivery)],
    })
    const handoff = references.every(({ referenceRef }) => referenceRef !== null)
      ? 'targeted'
      : 'reconciliation'
    deps.logger.info(
      {
        duplicate: receipt.status === 'duplicate',
        handoff,
        properties: references.length,
      },
      'GBP review push durably accepted',
    )
    return {
      accepted: true,
      duplicate: receipt.status === 'duplicate',
      handoff,
      propertyIds: references.map(({ property }) => property.id),
    }
  }
}

export type HandleGbpNotification = ReturnType<typeof handleGbpNotification>
