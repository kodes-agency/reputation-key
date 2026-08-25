import type { Database } from '#/shared/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { guestResponseMedia, guestResponses } from '#/shared/db/schema/guest.schema'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import type { GuestResponseCommandStore } from '../application/ports/guest-response-command-store.port'
import type { GuestMutationFact } from '../application/ports/guest-response-command-store.port'
import { guestResponseToInsertRow } from './mappers/guest-response.mapper'
import { trace } from '#/shared/observability/trace'

/** Atomic canonical response + rating/feedback fact writer. */
export function createAtomicGuestResponseCommandStore(
  db: Database,
  events: EventBus,
): GuestResponseCommandStore {
  const lineage = (
    response: Parameters<GuestResponseCommandStore['commitSubmitted']>[0],
    facts: ReadonlyArray<GuestMutationFact>,
  ) => {
    const rating = facts.find(
      (fact) =>
        fact._tag === 'guest.rating.submitted' || fact._tag === 'guest.rating.retracted',
    )
    const feedback = facts.find(
      (fact) =>
        fact._tag === 'guest.feedback.submitted' ||
        fact._tag === 'guest.feedback.retracted',
    )
    return {
      ratingSourceEventId:
        rating?._tag === 'guest.rating.submitted'
          ? rating.eventId
          : rating?._tag === 'guest.rating.retracted'
            ? null
            : response.ratingSourceEventId,
      feedbackSourceEventId:
        feedback?._tag === 'guest.feedback.submitted'
          ? feedback.eventId
          : feedback?._tag === 'guest.feedback.retracted'
            ? null
            : response.feedbackSourceEventId,
    }
  }

  return {
    commitSubmitted: (response, facts) =>
      trace('guest.commandStore.commitSubmitted', async () => {
        const outcome = await db.transaction(async (tx) => {
          const sourceLineage = lineage(response, facts)
          const inserted = await tx
            .insert(guestResponses)
            .values({ ...guestResponseToInsertRow(response), ...sourceLineage })
            .onConflictDoNothing()
            .returning({ id: guestResponses.id })
          if (inserted.length === 0) return 'duplicate' as const
          for (const fact of facts) await insertOutboxRow(tx, fact)
          return 'applied' as const
        })
        if (outcome === 'applied') {
          for (const fact of facts) await emitAfterCommit(events, fact)
        }
        return outcome
      }),

    commitCorrected: (response, facts) =>
      trace('guest.commandStore.commitCorrected', async () => {
        const sourceLineage = lineage(response, facts)
        const outcome = await db.transaction(async (tx) => {
          const updated = await tx
            .update(guestResponses)
            .set({
              status: response.status,
              rating: response.rating,
              categoryId: response.category,
              responseText: response.text,
              responseConsent: response.responseConsent,
              textConsent: response.textConsent,
              mediaConsent: response.mediaConsent,
              correctionCount: response.correctionCount,
              correctedAt: response.correctedAt,
              ratingSourceEventId: sourceLineage.ratingSourceEventId,
              feedbackSourceEventId: sourceLineage.feedbackSourceEventId,
              updatedAt: response.correctedAt ?? new Date(),
            })
            .where(
              and(
                eq(guestResponses.organizationId, response.organizationId),
                eq(guestResponses.propertyId, response.propertyId),
                eq(guestResponses.portalId, response.portalId),
                eq(guestResponses.sessionId, response.sessionId),
                eq(guestResponses.id, response.id),
                eq(guestResponses.status, 'submitted'),
                eq(guestResponses.correctionCount, 0),
                isNull(guestResponses.deletedAt),
              ),
            )
            .returning({ id: guestResponses.id })
          if (!updated[0]) return 'conflict' as const
          for (const fact of facts) await insertOutboxRow(tx, fact)
          return 'applied' as const
        })
        if (outcome === 'applied') {
          for (const fact of facts) await emitAfterCommit(events, fact)
        }
        return outcome
      }),

    commitWithdrawn: (response, facts) =>
      trace('guest.commandStore.commitWithdrawn', async () => {
        const committed = await db.transaction(async (tx) => {
          const deleted = await tx
            .update(guestResponses)
            .set({
              status: 'deleted',
              rating: null,
              categoryId: null,
              responseText: null,
              responseConsent: false,
              textConsent: false,
              mediaConsent: false,
              ratingSourceEventId: null,
              feedbackSourceEventId: null,
              deletedAt: response.deletedAt,
              updatedAt: response.deletedAt ?? new Date(),
            })
            .where(
              and(
                eq(guestResponses.organizationId, response.organizationId),
                eq(guestResponses.propertyId, response.propertyId),
                eq(guestResponses.portalId, response.portalId),
                eq(guestResponses.sessionId, response.sessionId),
                eq(guestResponses.id, response.id),
                eq(guestResponses.correctionCount, response.correctionCount),
                response.ratingSourceEventId
                  ? eq(guestResponses.ratingSourceEventId, response.ratingSourceEventId)
                  : isNull(guestResponses.ratingSourceEventId),
                response.feedbackSourceEventId
                  ? eq(
                      guestResponses.feedbackSourceEventId,
                      response.feedbackSourceEventId,
                    )
                  : isNull(guestResponses.feedbackSourceEventId),
                isNull(guestResponses.deletedAt),
              ),
            )
            .returning({ id: guestResponses.id })
          if (!deleted[0]) {
            return { outcome: 'conflict' as const, objectKeys: [] as const }
          }
          const media = await tx
            .update(guestResponseMedia)
            .set({
              status: 'purge_pending',
              processingLease: null,
              publicUrl: null,
              readyAt: null,
              deletedAt: response.deletedAt,
              updatedAt: response.deletedAt ?? new Date(),
            })
            .where(
              and(
                eq(guestResponseMedia.organizationId, response.organizationId),
                eq(guestResponseMedia.responseId, response.id),
                inArray(guestResponseMedia.status, ['issued', 'processing', 'ready']),
              ),
            )
            .returning({ objectKey: guestResponseMedia.objectKey })
          for (const fact of facts) await insertOutboxRow(tx, fact)
          return {
            outcome: 'applied' as const,
            objectKeys: media.map((item) => item.objectKey),
          }
        })
        if (committed.outcome === 'applied') {
          for (const fact of facts) await emitAfterCommit(events, fact)
        }
        return committed
      }),
  }
}
