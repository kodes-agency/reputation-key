// Review context — cancel in-flight reply publications for a Google connection (BQC-3.8).
//
// Triggered by integration.google_account.disconnected (and available to
// future policy cancellations): every reply of the connection's reviews that
// sits in an ACTIVE publication state (requested/authorized/sending) is
// cancelled — publication_state → 'cancelled', status → 'draft', one
// review.reply.publication_cancelled fact per reply, committed per batch in
// ONE transaction by the reply command store.
//
// Resolution mirrors the source-content purge (reviews.google_connection_id
// equality within the organization), keyset-bounded so a large connection
// never becomes one unbounded transaction. Rows whose publication moved on
// (published/failed/already cancelled) or that the disconnect purge already
// deleted are skipped by the store's guarded update — no fact, no error.
// Re-running is idempotent: cancelled rows no longer match the active-state
// query.
//
// property.archived cancels the same way for one Property's reviews
// (cancelPublicationsForProperty below, cause 'policy'), but only cycles not
// yet dispatched whose source epoch the Property has moved past.

import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type {
  CancelPublicationCommand,
  ReplyCommandStore,
} from '../ports/reply-command-store.port'
import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import { reviewReplyPublicationCancelled } from '../../domain/events'

export type CancelPublicationsForConnectionDeps = Readonly<{
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  commandStore: ReplyCommandStore
  clock: () => Date
  batchSize?: number
  maxBatches?: number
}>

export type CancelPublicationsForConnectionInput = Readonly<{
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  cause: 'disconnect' | 'policy'
}>

export type CancelPublicationsResult = Readonly<{
  reviewsScanned: number
  cancelled: number
  batches: number
}>

const DEFAULT_BATCH_SIZE = 500
const DEFAULT_MAX_BATCHES = 10

export const cancelPublicationsForConnection =
  (deps: CancelPublicationsForConnectionDeps) =>
  async (
    input: CancelPublicationsForConnectionInput,
  ): Promise<CancelPublicationsResult> => {
    const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
    const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES

    let cursor: Readonly<{ id: string }> | null = null
    let reviewsScanned = 0
    let cancelled = 0
    let batches = 0

    for (;;) {
      if (batches >= maxBatches) break
      const reviews = await deps.reviewRepo.findByConnection(
        input.organizationId,
        input.connectionId,
        cursor,
        batchSize,
      )
      if (reviews.length === 0) break
      batches++
      reviewsScanned += reviews.length

      const propertyByReviewId = new Map<string, PropertyId>(
        reviews.map((r) => [r.id as string, r.propertyId]),
      )
      const active = await deps.replyRepo.findPublicationActiveByReviewIds(
        reviews.map((r) => r.id),
        input.organizationId,
      )

      const now = deps.clock()
      const commands: CancelPublicationCommand[] = []
      for (const reply of active) {
        // Defensive: the reply resolved through these reviews, so the map
        // always has its propertyId — skip rather than record a fact-less id.
        const propertyId = propertyByReviewId.get(reply.reviewId as string)
        if (!propertyId) continue
        commands.push({
          reply,
          event: reviewReplyPublicationCancelled({
            replyId: reply.id,
            reviewId: reply.reviewId,
            propertyId,
            organizationId: input.organizationId,
            authorId: reply.createdBy,
            cause: input.cause,
            occurredAt: now,
          }),
          now,
        })
      }
      cancelled += await deps.commandStore.cancelPublications(commands)

      cursor = { id: reviews[reviews.length - 1].id as string }
    }

    return { reviewsScanned, cancelled, batches }
  }

export type CancelPublicationsForConnection = ReturnType<
  typeof cancelPublicationsForConnection
>

// ── Property archive ──────────────────────────────────────────────────

export type CancelPublicationsForPropertyDeps = Readonly<{
  replyRepo: Pick<ReplyRepository, 'findUnsendablePublicationsByPropertyId'>
  commandStore: Pick<ReplyCommandStore, 'cancelPublications'>
  clock: () => Date
  batchSize?: number
  maxBatches?: number
}>

export type CancelPublicationsForPropertyInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  cause: 'policy'
}>

export type CancelPublicationsForPropertyResult = Readonly<{
  cancelled: number
  batches: number
}>

/**
 * Cancel every publication cycle of one Property's reviews that can no longer
 * be sent: not yet dispatched, and authorized at a source epoch the Property
 * has moved past (Archive and Restore both advance it) or for a Property that
 * is not active. The provider authorizer would refuse each write, and the
 * worker must never report that refusal as "Google rejected the reply"; a
 * cancelled cycle is claimed by nobody and reported as a policy cancellation.
 * Keying on the epoch rather than on the Property being archived also clears
 * the pre-archive cycles when a Restore landed before this ran, while a cycle
 * approved at the restored epoch is left alone. A dispatched cycle may already
 * be on Google and stays with the worker and the reconciliation sweep.
 * Cancelled rows leave the set, so each batch reads the next one; a batch
 * that cancels nothing (every row moved on concurrently) ends the run rather
 * than re-reading the same rows.
 */
export const cancelPublicationsForProperty =
  (deps: CancelPublicationsForPropertyDeps) =>
  async (
    input: CancelPublicationsForPropertyInput,
  ): Promise<CancelPublicationsForPropertyResult> => {
    const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
    const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES

    let cancelled = 0
    let batches = 0
    while (batches < maxBatches) {
      const unsendable = await deps.replyRepo.findUnsendablePublicationsByPropertyId(
        input.propertyId,
        input.organizationId,
        batchSize,
      )
      if (unsendable.length === 0) break
      batches++
      const now = deps.clock()
      const count = await deps.commandStore.cancelPublications(
        unsendable.map((reply) => ({
          reply,
          event: reviewReplyPublicationCancelled({
            replyId: reply.id,
            reviewId: reply.reviewId,
            propertyId: input.propertyId,
            organizationId: input.organizationId,
            authorId: reply.createdBy,
            cause: input.cause,
            occurredAt: now,
          }),
          now,
        })),
      )
      cancelled += count
      if (count === 0 || unsendable.length < batchSize) break
    }

    return { cancelled, batches }
  }

export type CancelPublicationsForProperty = ReturnType<
  typeof cancelPublicationsForProperty
>
