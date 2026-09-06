// Outbox consumer registrations for the inbox context (PRE17A A4 / BQR-2.4 /
// BQC-3.4).
//
// Registers inbox's durable event consumers with the dispatcher. Each
// consumer:
// 1. Receives an identifier-only ConsumerEvent (no review text, PII)
// 2. Checks the receipt (idempotency — dispatcher pre-checks hasReceipt)
// 3. Applies the projection via InboxCommandStore applyOnce — state change,
//    outbox facts, and the receipt co-commit in ONE transaction (no crash
//    window can lose a fact or duplicate a side effect across redelivery).
//
// BQC-3.4: review.updated gained a metadata-only refresh consumer (sourceDate/
// platform only — content never copied onto inbox items, BQC-1.2);
// review.reply.published is receipt-only, while review.reply.observed is the
// durable exact-head authority for automatic Review close/reopen effects.

import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from '../application/ports/review-source-lookup.port'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'
import type { ReviewHandlingCycleStore } from '../application/ports/review-handling-cycle.store'
import type { ReplyObservationAuthorityPort } from '../application/ports/reply-observation-authority.port'
import type { SourceTransitionAuthorityPort } from '../application/ports/source-transition-authority.port'
import type { ReviewResponseTargetAuthorityPort } from '../application/ports/review-response-target-authority.port'
import type { InboxItemId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createInboxItem as buildInboxItem } from '../domain/constructors'
import { inboxError } from '../domain/errors'
import { inboxItemCreated, inboxItemStatusChanged } from '../domain/events'
import { organizationId, propertyId, reviewId, unbrand } from '#/shared/domain/ids'

export type InboxConsumerDeps = Readonly<{
  commandStore: InboxCommandStore
  handlingCycleStore: ReviewHandlingCycleStore
  replyObservationAuthority: ReplyObservationAuthorityPort
  responseTargetAuthority: ReviewResponseTargetAuthorityPort
  sourceTransitionAuthority: SourceTransitionAuthorityPort
  reviewLookup: ReviewLookupPort
  reviewSourceLookup: ReviewSourceLookupPort
  inboxRepo: InboxRepository
  idGen: () => InboxItemId
  clock: () => Date
  logger: LoggerPort
}>

const ON_REVIEW_CREATED = 'inbox.on-review-created'
const ON_REVIEW_EXPIRED = 'inbox.on-review-expired'
const ON_REVIEW_UPDATED = 'inbox.on-review-updated'
const ON_REVIEW_SOURCE_TRANSITIONED = 'inbox.on-review-source-transitioned'
const ON_REPLY_PUBLISHED = 'inbox.on-reply-published'
const ON_REPLY_OBSERVED = 'inbox.on-reply-observed'
const ON_REPLY_SUBMITTED = 'inbox.on-reply-submitted'

type ReviewIdPayload = Readonly<{
  reviewId: string
  organizationId: string
  propertyId: string
  sourceEpoch?: number
  sourceRevision?: number
}>

type ReviewCreatedPayload = ReviewIdPayload &
  Readonly<{
    occurredAt?: string | Date
    platform?: string
    externalId?: string
    sourceEpoch: number
    sourceRevision: number
  }>

type ReviewSourceTransitionedPayload = ReviewIdPayload &
  Readonly<{
    sourceEpoch: number
    sourceRevision: number
    analysisSequence: number
    change: 'source_expired' | 'provider_deleted'
    occurredAt: string | Date
  }>

type ReplyObservedPayload = ReviewIdPayload &
  Readonly<{
    observationRevision: number
    sourceEpoch: number
    materialReviewRevision: number
    change: 'added' | 'edited' | 'deleted' | 'unchanged'
    resolution: 'confirmed_on_google' | 'external_current_live' | 'diverged' | 'absent'
    provenance: 'repkey_confirmed' | 'external_or_unknown' | 'none'
    matchedReplyId: string | null
    matchedPublicationCycle: number | null
    occurredAt: string | Date
  }>

function asReviewCreatedPayload(payload: unknown): ReviewCreatedPayload {
  const p = payload as ReviewCreatedPayload
  return p
}

function asReviewIdPayload(payload: unknown): ReviewIdPayload {
  return payload as ReviewIdPayload
}

function asReviewSourceTransitionedPayload(
  payload: unknown,
): ReviewSourceTransitionedPayload {
  return payload as ReviewSourceTransitionedPayload
}

function asReplyObservedPayload(payload: unknown): ReplyObservedPayload {
  return payload as ReplyObservedPayload
}

async function handleInboxReviewProjection(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
  eventKind: 'created' | 'updated',
  consumerName: typeof ON_REVIEW_CREATED | typeof ON_REVIEW_UPDATED,
): Promise<ConsumerResult> {
  const payload = asReviewCreatedPayload(event.payload)
  if (
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Review projection envelope attribution does not match payload')
  }
  if (
    !Number.isSafeInteger(payload.sourceEpoch) ||
    payload.sourceEpoch < 0 ||
    !Number.isSafeInteger(payload.sourceRevision) ||
    payload.sourceRevision < 1
  ) {
    throw new Error('Review projection source version is invalid')
  }
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)
  const authority = await deps.responseTargetAuthority.withInboxProjection(
    {
      organizationId: payload.organizationId,
      propertyId: payload.propertyId,
      reviewId: payload.reviewId,
      sourceEpoch: payload.sourceEpoch,
      eventSourceRevision: payload.sourceRevision,
      eventKind,
    },
    async (projection) => {
      const initialRevision = projection.revisions[0]
      const built = buildInboxItem({
        id: deps.idGen(),
        organizationId: orgId,
        propertyId: propertyId(projection.propertyId),
        sourceType: 'review',
        sourceId: rId,
        sourceDate: projection.sourceDate,
        platform: projection.platform,
        assignedTo: null,
        clock: () => initialRevision.observedAt,
      })
      if (built.isErr()) throw built.error
      const item = built.value
      return deps.commandStore.applyReviewProjectionOnce({
        eventId: event.eventId,
        consumerName,
        eventKind,
        item,
        fact: inboxItemCreated({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          occurredAt: item.createdAt,
        }),
        projection,
        now: deps.clock(),
      })
    },
  )
  if (authority.status === 'obsolete') {
    await deps.commandStore.recordReceipt(event.eventId, consumerName, 'obsolete')
    return { status: 'obsolete' }
  }
  return { status: authority.value }
}

/** Exported for unit tests — review.created durable handler body. */
export async function handleInboxReviewCreated(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  return handleInboxReviewProjection(deps, event, 'created', ON_REVIEW_CREATED)
}

/** BQC-3.4 / BQR-2.4: close open inbox item when source review expires. */
export async function handleInboxReviewExpired(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = asReviewIdPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)
  const sourceId = unbrand(rId)
  const now = deps.clock()

  const item = await deps.inboxRepo.findBySource('review', sourceId, orgId)
  if (!item) {
    await deps.commandStore.recordReceipt(event.eventId, ON_REVIEW_EXPIRED, 'applied')
    return { status: 'applied' }
  }

  // Legacy review.expired delivery converges on the same content-free Inbox
  // command as review.source_transitioned. This matters for restored/pending
  // old events: an already-closed item must still lose provider-controlled
  // projection values rather than taking the former receipt-only shortcut.
  await deps.commandStore.applyReviewSourceTransitionedOnce({
    eventId: event.eventId,
    consumerName: ON_REVIEW_EXPIRED,
    item,
    transitionedAt: now,
    // This compatibility envelope has no source epoch/revision. It may be
    // arbitrarily delayed past re-observation, so it may erase forbidden
    // legacy projection copies but can never decide current workflow status.
    closeIfOpen: false,
    closeReason: 'source_ineligible',
    closeFact: inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: now,
    }),
  })
  return { status: 'applied' }
}

/**
 * REV-01 content-free handoff. Review owns the source lifecycle and records an
 * identifier-only transition. Inbox owns its stable projection, so it closes
 * unservable work and removes legacy provider-controlled copies itself. The
 * command store co-commits the scrub, optional status fact, and receipt.
 */
export async function handleInboxReviewSourceTransitioned(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = asReviewSourceTransitionedPayload(event.payload)
  if (
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error(
      'Review source transition envelope attribution does not match payload',
    )
  }
  const transitionedAt = new Date(payload.occurredAt)
  if (Number.isNaN(transitionedAt.getTime())) {
    throw new Error('Review source transition occurredAt is invalid')
  }
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)
  const authority = await deps.sourceTransitionAuthority.withExactCurrent(
    {
      organizationId: payload.organizationId,
      propertyId: payload.propertyId,
      reviewId: payload.reviewId,
      sourceEpoch: payload.sourceEpoch,
      sourceRevision: payload.sourceRevision,
      analysisSequence: payload.analysisSequence,
      change: payload.change,
      occurredAt: transitionedAt,
    },
    async () => {
      // Resolve the projection while Review holds the stable-source fence.
      // A current transition may overtake review.created, so absence is
      // retryable; an obsolete transition is handled outside the callback.
      const item = await deps.inboxRepo.findBySource('review', unbrand(rId), orgId)
      if (!item) {
        throw inboxError(
          'not_found',
          'Current Review source transition is waiting for its Inbox item',
        )
      }
      if (item.propertyId !== payload.propertyId) {
        throw new Error('Review source transition Property does not match Inbox item')
      }

      return deps.commandStore.applyReviewSourceTransitionedOnce({
        eventId: event.eventId,
        consumerName: ON_REVIEW_SOURCE_TRANSITIONED,
        item,
        transitionedAt,
        closeIfOpen: true,
        closeReason: 'source_ineligible',
        closeFact: inboxItemStatusChanged({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          oldStatus: 'open',
          newStatus: 'closed',
          occurredAt: transitionedAt,
        }),
      })
    },
  )
  if (authority.status === 'obsolete') {
    await deps.commandStore.recordReceipt(
      event.eventId,
      ON_REVIEW_SOURCE_TRANSITIONED,
      'obsolete',
    )
    return { status: 'obsolete' }
  }
  return { status: authority.value }
}

/**
 * BQC-3.4: review.updated metadata-only refresh (resolves the BQC-3.1
 * orphan). Only the projection-owned sourceDate/platform fields refresh —
 * content is never copied onto inbox items (BQC-1.2).
 */
export async function handleInboxReviewUpdated(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  return handleInboxReviewProjection(deps, event, 'updated', ON_REVIEW_UPDATED)
}

/** Compatibility consumer for the internal publication lifecycle fact.
 * It records delivery only; exact current observed Google truth exclusively
 * owns Inbox close/reopen transitions. */
export async function handleInboxReplyPublished(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  // Compatibility receipt only. `review.reply.published` is an internal
  // workflow fact and can no longer prove provider state; only the exact
  // current `review.reply.observed` head may mutate Inbox status.
  await deps.commandStore.recordReceipt(event.eventId, ON_REPLY_PUBLISHED, 'applied')
  return { status: 'applied' }
}

/**
 * Stamp the firstReplySubmittedAt milestone on the associated inbox item.
 * Milestone only — this consumer never touches `inbox_items.status`; exact
 * current observed Google truth (review.reply.observed) owns close/reopen.
 * The milestone update is idempotent because a set milestone is never
 * overwritten.
 */
export async function handleInboxReplySubmitted(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = asReviewIdPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const item = await deps.inboxRepo.findBySource(
    'review',
    unbrand(reviewId(payload.reviewId)),
    orgId,
  )
  if (!item || item.firstReplySubmittedAt) {
    await deps.commandStore.recordReceipt(event.eventId, ON_REPLY_SUBMITTED, 'applied')
    return { status: 'applied' }
  }
  const submittedAt = event.occurredAt ? new Date(event.occurredAt) : deps.clock()
  await deps.inboxRepo.stampReplyMilestones(
    item.id,
    item.organizationId,
    { firstReplySubmittedAt: submittedAt },
    submittedAt,
  )
  await deps.commandStore.recordReceipt(event.eventId, ON_REPLY_SUBMITTED, 'applied')
  return { status: 'applied' }
}

/** Apply the Review-owned current provider observation to the one current
 * Handling Cycle. Review holds its exact-head fence while the Inbox command
 * store atomically commits the state, fact, and receipt. */
export async function handleInboxReplyObserved(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = asReplyObservedPayload(event.payload)
  if (
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Reply observation envelope attribution does not match payload')
  }
  const occurredAt = new Date(payload.occurredAt)
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error('Reply observation occurredAt is invalid')
  }
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)
  const authority = await deps.replyObservationAuthority.withExactCurrent(
    {
      organizationId: payload.organizationId,
      propertyId: payload.propertyId,
      reviewId: payload.reviewId,
      observationRevision: payload.observationRevision,
      sourceEpoch: payload.sourceEpoch,
      materialReviewRevision: payload.materialReviewRevision,
      change: payload.change,
      resolution: payload.resolution,
      provenance: payload.provenance,
      matchedReplyId: payload.matchedReplyId,
      matchedPublicationCycle: payload.matchedPublicationCycle,
      occurredAt,
    },
    async (currentObservation) => {
      // The observed fact may overtake review.created because durable
      // consumers run concurrently. Only an obsolete Review head is a final
      // no-op: a current head with no Inbox projection must remain retryable.
      // Resolve the item while Review holds its observation fence so a later
      // head cannot replace this permit before the Inbox transaction commits.
      const item = await deps.inboxRepo.findBySource('review', unbrand(rId), orgId)
      if (!item) {
        throw inboxError(
          'not_found',
          'Current reply observation is waiting for its Review Inbox item',
        )
      }
      const cycleHead = await deps.handlingCycleStore.findHead(item.id, orgId)
      if (cycleHead === null) {
        throw inboxError(
          'not_found',
          'Current reply observation is waiting for its Inbox Handling Cycle',
        )
      }
      if (
        cycleHead.currentMaterialReviewRevision <
          currentObservation.materialReviewRevision &&
        !(
          currentObservation.sourceEpochCarryFromMaterialReviewRevision ===
            cycleHead.currentMaterialReviewRevision &&
          currentObservation.materialReviewRevision ===
            cycleHead.currentMaterialReviewRevision + 1
        )
      ) {
        throw inboxError(
          'revision_conflict',
          'Current reply observation is waiting for the Inbox material revision',
        )
      }
      if (
        cycleHead.currentMaterialReviewRevision >
        currentObservation.materialReviewRevision
      ) {
        await deps.commandStore.recordReceipt(
          event.eventId,
          ON_REPLY_OBSERVED,
          'obsolete',
        )
        return 'obsolete' as const
      }
      return deps.commandStore.applyReplyObservedOnce({
        eventId: event.eventId,
        consumerName: ON_REPLY_OBSERVED,
        item,
        currentObservation,
        closeFact: inboxItemStatusChanged({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          oldStatus: 'open',
          newStatus: 'closed',
          occurredAt: currentObservation.observedAt,
        }),
        reopenFact: inboxItemStatusChanged({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          oldStatus: 'closed',
          newStatus: 'open',
          occurredAt: currentObservation.observedAt,
        }),
      })
    },
  )
  if (authority.status === 'obsolete') {
    await deps.commandStore.recordReceipt(event.eventId, ON_REPLY_OBSERVED, 'obsolete')
    return { status: 'obsolete' }
  }
  return { status: authority.value }
}

/**
 * Register inbox consumers with the outbox dispatcher.
 * Called during worker startup (after bootstrap).
 */
export function registerInboxConsumers(
  registry: ConsumerRegistry,
  deps: InboxConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Consumer names MUST stay string literals here — the event-job catalogue
  // guard discovers durable consumers by scanning registerConsumer calls.
  registerConsumer({
    eventType: 'review.created',
    consumerName: 'inbox.on-review-created',
    module: 'inbox.outbox-consumers',
    handler: (event) => handleInboxReviewCreated(deps, event),
  })

  registerConsumer({
    eventType: 'review.expired',
    consumerName: 'inbox.on-review-expired',
    module: 'inbox.outbox-consumers',
    handler: (event) => handleInboxReviewExpired(deps, event),
  })

  registerConsumer({
    eventType: 'review.updated',
    consumerName: 'inbox.on-review-updated',
    module: 'inbox.outbox-consumers',
    handler: (event) => handleInboxReviewUpdated(deps, event),
  })

  registerConsumer({
    eventType: 'review.source_transitioned',
    consumerName: 'inbox.on-review-source-transitioned',
    module: 'inbox.outbox-consumers',
    handler: (event) => handleInboxReviewSourceTransitioned(deps, event),
  })

  registerConsumer({
    eventType: 'review.reply.published',
    consumerName: 'inbox.on-reply-published',
    module: 'inbox.outbox-consumers',
    handler: (event) => handleInboxReplyPublished(deps, event),
  })

  registerConsumer({
    eventType: 'review.reply.observed',
    consumerName: 'inbox.on-reply-observed',
    module: 'inbox.outbox-consumers',
    handler: (event) => handleInboxReplyObserved(deps, event),
  })

  registerConsumer({
    eventType: 'review.reply.submitted',
    consumerName: 'inbox.on-reply-submitted',
    module: 'inbox.outbox-consumers',
    handler: (event) => handleInboxReplySubmitted(deps, event),
  })

  deps.logger.info('Inbox consumers registered with outbox dispatcher (7 consumers)')
}
