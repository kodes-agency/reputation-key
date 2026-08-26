// Outbox consumer registrations for the inbox context (PRE17A A4 / BQR-2.4 /
// BQC-3.4).
//
// Registers inbox's durable event consumers with the dispatcher. Each
// consumer:
// 1. Receives an identifier-only ConsumerEvent (no review text, PII)
// 2. Checks the receipt (idempotency — dispatcher pre-checks hasReceipt)
// 3. Applies the projection via InboxCommandStore applyOnce — state change,
//    emitted facts, and the receipt co-commit in ONE transaction (no crash
//    window can lose a fact or duplicate a side effect across redelivery).
//
// BQC-3.4: review.updated gained a metadata-only refresh consumer (sourceDate/
// platform only — content never copied onto inbox items, BQC-1.2);
// review.reply.published is receipt-only, while review.reply.observed is the
// durable exact-head authority for automatic Review close/reopen effects.

import {
  registerConsumer,
  type ConsumerEvent,
  type ConsumerResult,
} from '#/shared/outbox'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from '../application/ports/review-source-lookup.port'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'
import type { ReviewHandlingCycleStore } from '../application/ports/review-handling-cycle.store'
import type { ReplyObservationAuthorityPort } from '../application/ports/reply-observation-authority.port'
import type { InboxItemId } from '#/shared/domain/ids'
import { createInboxItem as buildInboxItem } from '../domain/constructors'
import { inboxError } from '../domain/errors'
import { inboxItemCreated, inboxItemStatusChanged } from '../domain/events'
import { validateTransition } from '../domain/rules'
import { organizationId, propertyId, reviewId, unbrand } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'

export type InboxConsumerDeps = Readonly<{
  commandStore: InboxCommandStore
  handlingCycleStore: ReviewHandlingCycleStore
  replyObservationAuthority: ReplyObservationAuthorityPort
  reviewLookup: ReviewLookupPort
  reviewSourceLookup: ReviewSourceLookupPort
  inboxRepo: InboxRepository
  idGen: () => InboxItemId
  clock: () => Date
}>

const ON_REVIEW_CREATED = 'inbox.on-review-created'
const ON_REVIEW_EXPIRED = 'inbox.on-review-expired'
const ON_REVIEW_UPDATED = 'inbox.on-review-updated'
const ON_REPLY_PUBLISHED = 'inbox.on-reply-published'
const ON_REPLY_OBSERVED = 'inbox.on-reply-observed'

type ReviewIdPayload = Readonly<{
  reviewId: string
  organizationId: string
  propertyId: string
}>

type ReviewCreatedPayload = ReviewIdPayload &
  Readonly<{
    occurredAt?: string | Date
    platform?: string
    externalId?: string
    sourceRevision?: number
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

function asReplyObservedPayload(payload: unknown): ReplyObservedPayload {
  return payload as ReplyObservedPayload
}

/**
 * Record a consumer no-op (BQC-5.9 E20): warn with the consumer's log fields,
 * mark the event applied via the receipt, and return the applied result.
 * Used when the row the event targets is gone — the receipt marks the event
 * as consumed and rebuild heals if the projection row should exist.
 */
async function appliedNoopReceipt(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
  consumerName: string,
  logFields: Readonly<Record<string, unknown>>,
  message: string,
): Promise<ConsumerResult> {
  getLogger().warn(logFields, message)
  await deps.commandStore.recordReceipt(event.eventId, consumerName, 'applied')
  return { status: 'applied' }
}

/** Exported for unit tests — review.created durable handler body. */
export async function handleInboxReviewCreated(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const logger = getLogger()
  const payload = asReviewCreatedPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)

  // Existence check only — BQC-1.2: content is never copied onto inbox
  // items; both fresh and expired reviews get a metadata-only item (reads
  // resolve live via the eligibility-enforcing lookup).
  const result = await deps.reviewLookup.getReviewSnippetById(rId, orgId)

  if (result.status === 'not_found') {
    logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'inbox.on-review-created: review not found — marking obsolete',
    )
    await deps.commandStore.recordReceipt(event.eventId, ON_REVIEW_CREATED, 'obsolete')
    return { status: 'obsolete' }
  }

  const sourceDate =
    payload.occurredAt != null ? new Date(payload.occurredAt) : deps.clock()

  const built = buildInboxItem({
    id: deps.idGen(),
    organizationId: orgId,
    propertyId: propertyId(payload.propertyId),
    sourceType: 'review',
    sourceId: rId,
    sourceDate,
    platform: (payload.platform as 'google') ?? 'google',
    assignedTo: null,
    clock: deps.clock,
  })
  if (built.isErr()) throw built.error
  const item = built.value

  // One tx: idempotent create + created fact (only when created) + receipt.
  const outcome = await deps.commandStore.applySourceCreatedOnce({
    eventId: event.eventId,
    consumerName: ON_REVIEW_CREATED,
    item,
    fact: inboxItemCreated({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      occurredAt: item.createdAt,
    }),
    ...(payload.sourceRevision !== undefined
      ? { reviewCycleAnchor: { materialReviewRevision: payload.sourceRevision } }
      : {}),
  })
  return { status: outcome }
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

  if (validateTransition(item.status, 'closed').isErr()) {
    // Already closed (or other illegal transition) — idempotent.
    await deps.commandStore.recordReceipt(event.eventId, ON_REVIEW_EXPIRED, 'applied')
    return { status: 'applied' }
  }

  // One tx: guarded close + status_changed fact (only when the close lands)
  // + receipt. The pre-BQC-3.4 crash window that could lose the fact is gone.
  await deps.commandStore.applyReviewExpiredOnce({
    eventId: event.eventId,
    consumerName: ON_REVIEW_EXPIRED,
    item,
    now,
    fact: inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus: item.status,
      newStatus: 'closed',
      occurredAt: now,
    }),
  })
  return { status: 'applied' }
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
  const payload = asReviewIdPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)

  const item = await deps.inboxRepo.findBySource('review', unbrand(rId), orgId)
  if (!item) {
    // No projection row — nothing to refresh. Rebuild heals if the item
    // should exist; the receipt marks the event as consumed.
    return appliedNoopReceipt(
      deps,
      event,
      ON_REVIEW_UPDATED,
      { reviewId: payload.reviewId, eventId: event.eventId },
      'inbox.on-review-updated: no inbox item — applied no-op (rebuild heals)',
    )
  }

  const meta = await deps.reviewSourceLookup.getReviewSourceMetaById(rId, orgId)
  if (!meta) {
    return appliedNoopReceipt(
      deps,
      event,
      ON_REVIEW_UPDATED,
      { reviewId: payload.reviewId, eventId: event.eventId },
      'inbox.on-review-updated: review missing — applied no-op',
    )
  }

  // A material source change starts a new numbered work episode before the
  // event receipt is committed. If the process stops between these steps,
  // redelivery observes the already-advanced head and safely records only the
  // remaining metadata/receipt transaction.
  if (meta.materialReviewRevision !== null) {
    const head = await deps.handlingCycleStore.findHead(item.id, orgId)
    if (
      head !== null &&
      meta.materialReviewRevision > head.currentMaterialReviewRevision
    ) {
      try {
        await deps.handlingCycleStore.startNext({
          inboxItemId: item.id,
          organizationId: orgId,
          expected: {
            cycleNumber: head.currentCycleNumber,
            materialReviewRevision: head.currentMaterialReviewRevision,
            stateRevision: head.stateRevision,
          },
          materialReviewRevision: meta.materialReviewRevision,
          openedReason: 'material_revision_changed',
          openedBy: null,
          openedAt: deps.clock(),
        })
      } catch (error) {
        // A concurrent writer may have advanced the same (or a later) Review
        // revision. Treat that as convergence; any other conflict/failure is
        // retried by the durable consumer.
        const latest = await deps.handlingCycleStore.findHead(item.id, orgId)
        if (
          latest === null ||
          latest.currentMaterialReviewRevision < meta.materialReviewRevision
        ) {
          throw error
        }
      }
    }
  }

  await deps.commandStore.applyReviewUpdatedOnce({
    eventId: event.eventId,
    consumerName: ON_REVIEW_UPDATED,
    item,
    sourceDate: meta.sourceDate,
    platform: meta.platform,
    now: deps.clock(),
  })
  return { status: 'applied' }
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
        currentObservation.materialReviewRevision
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
export function registerInboxConsumers(deps: InboxConsumerDeps): void {
  const logger = getLogger()

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

  logger.info('Inbox consumers registered with outbox dispatcher (5 consumers)')
}
