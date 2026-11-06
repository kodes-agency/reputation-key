import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import type { ReviewQueuePort } from '#/contexts/review/application/public-api'
import type { PortalPublicDisplayNameDefaultPublicApi } from '#/contexts/portal/application/public-api'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { ManageNotificationsApi } from '../application/use-cases/manage-notifications'

export const IMPORT_DISPLAY_NAME_CONSUMER = 'integration.import-display-name'
export const IMPORT_SUBSCRIPTION_CONSUMER = 'integration.import-subscription'
export const IMPORT_REVIEW_SYNC_CONSUMER = 'integration.import-review-sync'

type FollowUpDeps = Readonly<{
  propertyBindingApi?: PropertyGoogleBindingPublicApi
  enqueueReviewSync?: ReviewQueuePort['addSyncJob']
  defaultPublicDisplayName?: PortalPublicDisplayNameDefaultPublicApi['ensureDefaultPublicDisplayName']
  subscribe: ManageNotificationsApi['subscribe']
  receipts: Pick<OutboxRepository, 'hasReceipt' | 'insertReceipt'>
  newDeliveryId: () => string
}>

type BindingPayload = Readonly<{
  organizationId: string
  propertyId: string
  connectionId: string
  sourceEpoch: number
  change: 'created' | 'relinked' | 'disconnected' | 'deletion_started'
  importFollowUps?: true
}>

type InternalBinding = Awaited<ReturnType<PropertyGoogleBindingPublicApi['readInternal']>>

function isCurrentBinding(
  binding: InternalBinding,
  payload: BindingPayload,
): binding is NonNullable<InternalBinding> & {
  accountId: string
  locationId: string
  connectionId: NonNullable<NonNullable<InternalBinding>['connectionId']>
} {
  return !(
    !binding ||
    binding.state !== 'active' ||
    binding.deletedAt !== null ||
    binding.lifecycleState !== 'active' ||
    binding.sourceEpoch !== payload.sourceEpoch ||
    binding.connectionId !== payload.connectionId ||
    binding.accountId === null ||
    binding.locationId === null
  )
}

/** Each effect owns its acknowledgement. A death between effect and receipt
 * repeats a conditional default, a desired-state subscription, or a sync whose
 * durable snapshot run serializes duplicate admissions. */
export function createGoogleBindingFollowUpHandlers(deps: FollowUpDeps) {
  const handle = async (event: ConsumerEvent, consumer: string) => {
    if (await deps.receipts.hasReceipt(event.eventId, consumer))
      return { status: 'duplicate' as const }
    const payload = validateEventPayload(
      'property.google_binding.changed',
      event.eventVersion,
      event.payload,
    ) as BindingPayload | undefined
    if (
      !payload ||
      event.eventType !== 'property.google_binding.changed' ||
      payload.organizationId !== event.organizationId ||
      payload.propertyId !== event.propertyId ||
      payload.propertyId !== event.sourceAggregateId
    ) {
      throw new Error('Google binding follow-up attribution mismatch')
    }
    const receipt = async (status: 'applied' | 'obsolete') => {
      await deps.receipts.insertReceipt(event.eventId, consumer, status)
      return { status }
    }
    if (
      !payload.importFollowUps ||
      (payload.change !== 'created' && payload.change !== 'relinked')
    )
      return receipt('obsolete')
    if (!deps.propertyBindingApi) throw new Error('Property binding reader unavailable')
    const binding = await deps.propertyBindingApi.readInternal(
      organizationId(payload.organizationId),
      propertyId(payload.propertyId),
    )
    if (!isCurrentBinding(binding, payload)) return receipt('obsolete')
    if (consumer === IMPORT_DISPLAY_NAME_CONSUMER) {
      if (!deps.defaultPublicDisplayName)
        throw new Error('Public display name default unavailable')
      await deps.defaultPublicDisplayName({
        organizationId: organizationId(payload.organizationId),
        propertyId: propertyId(payload.propertyId),
        displayName: binding.name,
      })
    } else if (consumer === IMPORT_SUBSCRIPTION_CONSUMER) {
      const result = await deps.subscribe(
        organizationId(payload.organizationId),
        binding.connectionId,
      )
      // An account with no topic configured has no subscription obligation.
      // Partial/provider/coordination failures remain owed for redelivery.
      if (!['subscribed', 'already_subscribed', 'topic_unset'].includes(result.outcome))
        throw new Error('Google import subscription incomplete')
    } else {
      if (!deps.enqueueReviewSync) throw new Error('Review sync admission unavailable')
      await deps.enqueueReviewSync(
        {
          organizationId: payload.organizationId,
          propertyId: payload.propertyId,
          connectionId: binding.connectionId,
          locationName: `accounts/${binding.accountId}/locations/${binding.locationId}`,
          sourceEpoch: payload.sourceEpoch,
          importBindingEventId: event.eventId,
          initiator: { kind: 'system', id: 'google-property-import' },
          correlationId: `google-import:${event.eventId}`,
        },
        { jobId: `review-sync-${event.eventId}-${deps.newDeliveryId()}` },
      )
      // Redis acceptance is not durable acceptance. Until a Review worker has
      // committed progress, outbox recovery must still see this obligation.
      if (!(await deps.receipts.hasReceipt(event.eventId, consumer)))
        throw new Error('Google import sync awaiting durable acceptance')
      return { status: 'applied' as const }
    }
    return receipt('applied')
  }
  const deliver = async (event: ConsumerEvent, consumer: string) => {
    try {
      return await handle(event, consumer)
    } catch {
      // Dispatcher errors are code-only; storage/provider errors may carry
      // customer content or SQL parameters in their messages.
      const reason =
        consumer === IMPORT_DISPLAY_NAME_CONSUMER
          ? 'Google import display name unavailable'
          : consumer === IMPORT_SUBSCRIPTION_CONSUMER
            ? 'Google import subscription incomplete'
            : 'Google import sync awaiting durable acceptance'
      throw new Error(reason)
    }
  }
  return {
    displayName: (event: ConsumerEvent) => deliver(event, IMPORT_DISPLAY_NAME_CONSUMER),
    subscription: (event: ConsumerEvent) => deliver(event, IMPORT_SUBSCRIPTION_CONSUMER),
    reviewSync: (event: ConsumerEvent) => deliver(event, IMPORT_REVIEW_SYNC_CONSUMER),
  }
}

export function registerGoogleBindingFollowUpConsumers(
  registry: ConsumerRegistry,
  deps: FollowUpDeps,
): void {
  const handlers = createGoogleBindingFollowUpHandlers(deps)
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'property.google_binding.changed',
    consumerName: IMPORT_DISPLAY_NAME_CONSUMER,
    module: 'integration.property-import-dispatch',
    handler: handlers.displayName,
  })
  registerConsumer({
    eventType: 'property.google_binding.changed',
    consumerName: IMPORT_SUBSCRIPTION_CONSUMER,
    module: 'integration.property-import-dispatch',
    handler: handlers.subscription,
  })
  registerConsumer({
    eventType: 'property.google_binding.changed',
    consumerName: IMPORT_REVIEW_SYNC_CONSUMER,
    module: 'integration.property-import-dispatch',
    handler: handlers.reviewSync,
  })
}
