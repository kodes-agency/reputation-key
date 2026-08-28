import type { InboxItemId } from '#/shared/domain/ids'
import { feedbackId, organizationId, propertyId } from '#/shared/domain/ids'
import {
  registerConsumer,
  type ConsumerEvent,
  type ConsumerResult,
} from '#/shared/outbox'
import type { FeedbackLookupPort } from '../application/ports/feedback-lookup.port'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'
import type { InboxRepository } from '../application/ports/inbox.repository'
import { createInboxItem as buildInboxItem } from '../domain/constructors'
import { inboxItemCreated, inboxItemStatusChanged } from '../domain/events'

export type GuestFeedbackConsumerDeps = Readonly<{
  commandStore: InboxCommandStore
  feedbackLookup: FeedbackLookupPort
  inboxRepo: InboxRepository
  idGen: () => InboxItemId
  clock: () => Date
}>

const CONSUMER_NAME = 'inbox.on-guest-feedback-submitted'
const RETRACTION_CONSUMER_NAME = 'inbox.on-guest-feedback-retracted'

type GuestFeedbackScopePayload = Readonly<{
  feedbackId: string
  organizationId: string
  propertyId: string
  portalId: string
  occurredAt: string
}>

type GuestFeedbackPayload = GuestFeedbackScopePayload &
  Readonly<{ ratingId: string | null; responseRevision?: number }>

type GuestFeedbackRetractionPayload = GuestFeedbackScopePayload &
  Readonly<{ supersedesSourceEventId: string; responseRevision?: number }>

export type GuestFeedbackRetractionInput = Readonly<{
  eventId: string
  feedbackId: string
  organizationId: string
  propertyId: string
  responseRevision?: number
  occurredAt: Date
}>

export type GuestFeedbackRetractionDeps = Readonly<{
  commandStore: Pick<InboxCommandStore, 'applySourceWithdrawnOnce' | 'recordReceipt'>
  inboxRepo: Pick<InboxRepository, 'findBySource'>
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
  if (!source?.comment) {
    await deps.commandStore.recordReceipt(event.eventId, CONSUMER_NAME, 'obsolete')
    return { status: 'obsolete' }
  }
  const responseRevision = payload.responseRevision ?? source.responseRevision ?? 1
  if (
    !Number.isSafeInteger(responseRevision) ||
    responseRevision < 1 ||
    (payload.responseRevision !== undefined &&
      source.responseRevision !== null &&
      payload.responseRevision !== source.responseRevision)
  ) {
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
    cycleAnchor: {
      sourceRevision: responseRevision,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: event.eventId,
      openedAt: sourceDate,
    },
  })
  return { status: outcome }
}

/** Close manager work after Guest has purged its private feedback body. */
export async function applyInboxGuestFeedbackRetraction(
  deps: GuestFeedbackRetractionDeps,
  input: GuestFeedbackRetractionInput,
): Promise<ConsumerResult> {
  if (Number.isNaN(input.occurredAt.getTime())) {
    throw new Error('Guest feedback occurredAt is invalid')
  }
  const sourceRevision = input.responseRevision ?? 1
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 1) {
    throw new Error('Guest feedback responseRevision is invalid')
  }
  const orgId = organizationId(input.organizationId)
  const item = await deps.inboxRepo.findBySource('feedback', input.feedbackId, orgId)
  if (!item) {
    await deps.commandStore.recordReceipt(
      input.eventId,
      RETRACTION_CONSUMER_NAME,
      'applied',
    )
    return { status: 'applied' }
  }
  if ((item.propertyId as string) !== input.propertyId) {
    throw new Error('Guest feedback Inbox scope does not match its source fact')
  }
  const outcome = await deps.commandStore.applySourceWithdrawnOnce({
    eventId: input.eventId,
    consumerName: RETRACTION_CONSUMER_NAME,
    item,
    sourceRevision,
    now: input.occurredAt,
    fact: inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      // The compatibility row is deliberately not workflow authority. The
      // locked Cycle Head decides whether this canonical open -> closed fact
      // lands or the withdrawal is already complete.
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: input.occurredAt,
    }),
  })
  return { status: outcome }
}

/** Durable envelope adapter for the shared, receipt-coordinated apply seam. */
export async function handleInboxGuestFeedbackRetracted(
  deps: GuestFeedbackConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = event.payload as GuestFeedbackRetractionPayload
  if (
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Guest feedback envelope attribution does not match its payload')
  }
  return applyInboxGuestFeedbackRetraction(deps, {
    eventId: event.eventId,
    feedbackId: payload.feedbackId,
    organizationId: payload.organizationId,
    propertyId: payload.propertyId,
    responseRevision: payload.responseRevision,
    occurredAt: new Date(payload.occurredAt),
  })
}

export function registerGuestFeedbackConsumer(deps: GuestFeedbackConsumerDeps): void {
  registerConsumer({
    eventType: 'guest.feedback.submitted',
    consumerName: 'inbox.on-guest-feedback-submitted',
    module: 'inbox.guest-feedback',
    handler: (event) => handleInboxGuestFeedbackSubmitted(deps, event),
  })
  registerConsumer({
    eventType: 'guest.feedback.retracted',
    consumerName: 'inbox.on-guest-feedback-retracted',
    module: 'inbox.guest-feedback',
    handler: (event) => handleInboxGuestFeedbackRetracted(deps, event),
  })
}
