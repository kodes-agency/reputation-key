import type { InboxItemId } from '#/shared/domain/ids'
import { feedbackId, organizationId, propertyId } from '#/shared/domain/ids'
import {
  registerConsumer,
  type ConsumerEvent,
  type ConsumerResult,
} from '#/shared/outbox/dispatcher'
import type { FeedbackLookupPort } from '../application/ports/feedback-lookup.port'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'
import { createInboxItem as buildInboxItem } from '../domain/constructors'
import { inboxItemCreated } from '../domain/events'

export type GuestFeedbackConsumerDeps = Readonly<{
  commandStore: InboxCommandStore
  feedbackLookup: FeedbackLookupPort
  idGen: () => InboxItemId
  clock: () => Date
}>

const CONSUMER_NAME = 'inbox.on-guest-feedback-submitted'

type GuestFeedbackPayload = Readonly<{
  feedbackId: string
  ratingId: string | null
  organizationId: string
  propertyId: string
  portalId: string
  occurredAt: string
}>

/** Durable, metadata-only private-feedback projection into manager Inbox. */
export async function handleInboxGuestFeedbackSubmitted(
  deps: GuestFeedbackConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = event.payload as GuestFeedbackPayload
  if (
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Guest feedback envelope attribution does not match its payload')
  }

  const orgId = organizationId(payload.organizationId)
  const sourceId = feedbackId(payload.feedbackId)
  const sourceDate = new Date(payload.occurredAt)
  if (Number.isNaN(sourceDate.getTime())) {
    throw new Error('Guest feedback occurredAt is invalid')
  }

  // A withdrawal/deletion may win before durable delivery. Do not recreate
  // a projection whose governed live-read source is already unavailable.
  const source = await deps.feedbackLookup.getFeedbackSnippetById(sourceId, orgId)
  if (!source) {
    await deps.commandStore.recordReceipt(event.eventId, CONSUMER_NAME, 'obsolete')
    return { status: 'obsolete' }
  }

  const built = buildInboxItem({
    id: deps.idGen(),
    organizationId: orgId,
    propertyId: propertyId(payload.propertyId),
    sourceType: 'feedback',
    sourceId,
    sourceDate,
    platform: null,
    assignedTo: null,
    clock: deps.clock,
  })
  if (built.isErr()) throw built.error
  const item = built.value

  const outcome = await deps.commandStore.applySourceCreatedOnce({
    eventId: event.eventId,
    consumerName: CONSUMER_NAME,
    item,
    fact: inboxItemCreated({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      occurredAt: item.createdAt,
    }),
  })
  return { status: outcome }
}

export function registerGuestFeedbackConsumer(deps: GuestFeedbackConsumerDeps): void {
  registerConsumer({
    eventType: 'guest.feedback.submitted',
    consumerName: 'inbox.on-guest-feedback-submitted',
    module: 'inbox.guest-feedback',
    handler: (event) => handleInboxGuestFeedbackSubmitted(deps, event),
  })
}
