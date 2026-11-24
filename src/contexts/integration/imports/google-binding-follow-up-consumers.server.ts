import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/public-api'
import type { ReviewQueuePort } from '#/contexts/reputation/public-api'
import type { PortalPublicDisplayNameDefaultPublicApi } from '#/contexts/portal/public-api'
import { PrerequisiteNotReadyError } from '#/shared/outbox'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { ManageNotificationsApi } from '../connections/manage-notifications.server'

export const IMPORT_DISPLAY_NAME_CONSUMER = 'integration.import-display-name'
export const IMPORT_SUBSCRIPTION_CONSUMER = 'integration.import-subscription'
export const IMPORT_REVIEW_SYNC_CONSUMER = 'integration.import-review-sync'

type FollowUpDeps = Readonly<{
  propertyBindingApi: PropertyGoogleBindingPublicApi
  enqueueReviewSync: ReviewQueuePort['addSyncJob']
  defaultPublicDisplayName: PortalPublicDisplayNameDefaultPublicApi['ensureDefaultPublicDisplayName']
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

type CurrentBinding = NonNullable<InternalBinding> & {
  accountId: string
  locationId: string
  connectionId: NonNullable<NonNullable<InternalBinding>['connectionId']>
}

function isCurrentBinding(
  binding: InternalBinding,
  payload: BindingPayload,
): binding is CurrentBinding {
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
  type Effect = (
    event: ConsumerEvent,
    payload: BindingPayload,
    binding: CurrentBinding,
  ) => Promise<void>

  const setDisplayName: Effect = async (_event, payload, binding) => {
    await deps.defaultPublicDisplayName({
      organizationId: organizationId(payload.organizationId),
      propertyId: propertyId(payload.propertyId),
      displayName: binding.name,
    })
  }
  const subscribeAccount: Effect = async (_event, payload, binding) => {
    const result = await deps.subscribe(
      organizationId(payload.organizationId),
      binding.connectionId,
      { gbpAccountId: binding.accountId, reuseVerified: true },
    )
    // An account with no topic configured has no subscription obligation.
    // Partial/provider/coordination failures remain owed for redelivery.
    if (!['subscribed', 'already_subscribed', 'topic_unset'].includes(result.outcome))
      throw new Error('Google import subscription incomplete')
  }
  const admitReviewSync: Effect = async (event, payload, binding) => {
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
  }

  const handle = async (event: ConsumerEvent, consumer: string, effect: Effect) => {
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
    const binding = await deps.propertyBindingApi.readInternal(
      organizationId(payload.organizationId),
      propertyId(payload.propertyId),
    )
    if (!isCurrentBinding(binding, payload)) return receipt('obsolete')
    await effect(event, payload, binding)
    if (consumer === IMPORT_REVIEW_SYNC_CONSUMER) {
      // Redis acceptance is not durable acceptance. Until a Review worker has
      // committed progress, outbox recovery must still see this obligation.
      if (!(await deps.receipts.hasReceipt(event.eventId, consumer)))
        throw new PrerequisiteNotReadyError(
          'Google import sync awaiting durable acceptance',
        )
      return { status: 'applied' as const }
    }
    return receipt('applied')
  }
  // An ordering wait passes through; any other failure is reduced to a code.
  // Dispatcher errors are code-only; storage/provider errors may carry
  // customer content or SQL parameters in their messages.
  const deliver = async (
    event: ConsumerEvent,
    consumer: string,
    effect: Effect,
    reason: string,
  ) => {
    let failure: unknown
    try {
      return await handle(event, consumer, effect)
    } catch (err) {
      failure = err
    }
    if (failure instanceof PrerequisiteNotReadyError) throw failure
    throw new Error(reason)
  }
  return {
    displayName: (event: ConsumerEvent) =>
      deliver(
        event,
        IMPORT_DISPLAY_NAME_CONSUMER,
        setDisplayName,
        'Google import display name unavailable',
      ),
    subscription: (event: ConsumerEvent) =>
      deliver(
        event,
        IMPORT_SUBSCRIPTION_CONSUMER,
        subscribeAccount,
        'Google import subscription incomplete',
      ),
    reviewSync: (event: ConsumerEvent) =>
      deliver(
        event,
        IMPORT_REVIEW_SYNC_CONSUMER,
        admitReviewSync,
        'Google import sync awaiting durable acceptance',
      ),
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
