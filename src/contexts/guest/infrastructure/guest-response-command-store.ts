import type { Database } from '#/shared/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  guestResponseExperienceSnapshots,
  guestResponseIntegrityDecisions,
  guestResponseMedia,
  guestResponsePrivateFeedback,
  guestResponseSessionBindings,
  guestResponses,
} from '#/shared/db/schema/guest.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { GuestResponseCommandStore } from '../application/ports/guest-response-command-store.port'
import type { GuestMutationFact } from '../application/ports/guest-response-command-store.port'
import { guestResponseToInsertRow } from './mappers/guest-response.mapper'
import { trace } from '#/shared/observability/trace'
import {
  DEFAULT_RESPONSE_SESSION_WINDOW_MS,
  PRIVATE_FEEDBACK_RETENTION_MS,
} from '../domain/guest-response'
import {
  initialGuestResponseIntegrityDecision,
  isRatingMetricEligible,
  ratingMetricOccurredAt,
} from '../domain/guest-response-integrity'
import { primaryStaffAttributionEquals } from '#/shared/domain/primary-staff-attribution'
import type { Clock } from '#/shared/domain/clock'

class GuestCommandConflict extends Error {}

function requireSessionBinding(
  response: Parameters<GuestResponseCommandStore['commitSubmitted']>[0],
): Readonly<{ sessionId: string; expiresAt: Date }> | null {
  return response.sessionId && response.sessionExpiresAt
    ? { sessionId: response.sessionId, expiresAt: response.sessionExpiresAt }
    : null
}

function sessionBindingExists(
  response: Parameters<GuestResponseCommandStore['commitSubmitted']>[0],
  asOf: Date,
  matchExpiry = true,
) {
  const binding = requireSessionBinding(response)
  if (!binding) return sql`false`
  const expiryMatch = matchExpiry
    ? sql`AND ${guestResponseSessionBindings.expiresAt} = ${binding.expiresAt}`
    : sql``
  return sql`EXISTS (
    SELECT 1 FROM ${guestResponseSessionBindings}
    WHERE ${guestResponseSessionBindings.responseId} = ${response.id}
      AND ${guestResponseSessionBindings.organizationId} = ${response.organizationId}
      AND ${guestResponseSessionBindings.propertyId} = ${response.propertyId}
      AND ${guestResponseSessionBindings.portalId} = ${response.portalId}
      AND ${guestResponseSessionBindings.sessionId} = ${binding.sessionId}
      ${expiryMatch}
      AND ${guestResponseSessionBindings.expiresAt} > ${asOf}
  )`
}

function privateFeedbackExpiry(submittedAt: Date): Date {
  return new Date(submittedAt.getTime() + PRIVATE_FEEDBACK_RETENTION_MS)
}

function integrityFactsMatch(
  previous: Parameters<GuestResponseCommandStore['commitIntegrityChanged']>[0],
  response: Parameters<GuestResponseCommandStore['commitIntegrityChanged']>[1],
  facts: Parameters<GuestResponseCommandStore['commitIntegrityChanged']>[3],
): boolean {
  if (
    facts.some(
      (fact) =>
        fact._tag !== 'guest.rating.submitted' && fact._tag !== 'guest.rating.retracted',
    )
  ) {
    return false
  }
  const wasEligible = isRatingMetricEligible(previous)
  const isEligible = isRatingMetricEligible(response)
  if (wasEligible === isEligible) return facts.length === 0
  if (facts.length !== 1) return false
  const fact = facts[0]!
  if (fact._tag !== 'guest.rating.submitted' && fact._tag !== 'guest.rating.retracted') {
    return false
  }
  const commonMatches =
    fact.ratingId === response.id &&
    fact.organizationId === response.organizationId &&
    fact.propertyId === response.propertyId &&
    fact.portalId === response.portalId
  if (!commonMatches) return false
  if (wasEligible) {
    return (
      fact._tag === 'guest.rating.retracted' &&
      previous.ratingSourceEventId !== null &&
      fact.supersedesSourceEventId === previous.ratingSourceEventId &&
      fact.occurredAt.getTime() === response.integrityAssessedAt.getTime()
    )
  }
  return (
    fact._tag === 'guest.rating.submitted' &&
    fact.value === response.rating &&
    (fact.supersedesSourceEventId ?? null) === previous.ratingSourceEventId &&
    fact.occurredAt.getTime() === ratingMetricOccurredAt(response).getTime()
  )
}

function initialIntegrityFactsMatch(
  response: Parameters<GuestResponseCommandStore['commitSubmitted']>[0],
  facts: Parameters<GuestResponseCommandStore['commitSubmitted']>[1],
): boolean {
  const ratingFacts = facts.filter((fact) => fact._tag === 'guest.rating.submitted')
  if (!isRatingMetricEligible(response)) return ratingFacts.length === 0
  if (ratingFacts.length !== 1) return false
  const fact = ratingFacts[0]!
  return (
    fact.ratingId === response.id &&
    fact.organizationId === response.organizationId &&
    fact.propertyId === response.propertyId &&
    fact.portalId === response.portalId &&
    fact.value === response.rating &&
    !fact.supersedesSourceEventId &&
    fact.occurredAt.getTime() === response.integrityAssessedAt.getTime()
  )
}

/** Atomic canonical response + rating/feedback fact writer. */
export const createAtomicGuestResponseCommandStore = (
  db: Database,
  clock: Clock,
): GuestResponseCommandStore => {
  const factsMatchStaffAttribution = (
    response: Parameters<GuestResponseCommandStore['commitSubmitted']>[0],
    facts: ReadonlyArray<GuestMutationFact>,
  ) =>
    facts.every((fact) =>
      primaryStaffAttributionEquals(response.staffAttribution, fact.staffAttribution),
    )

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
    commitSubmitted: (
      response,
      facts,
      initialIntegrity = initialGuestResponseIntegrityDecision(response),
    ) =>
      trace('guest.commandStore.commitSubmitted', async () => {
        const binding = requireSessionBinding(response)
        if (
          !binding ||
          !response.submittedAt ||
          !response.experienceSnapshot ||
          !factsMatchStaffAttribution(response, facts) ||
          facts.some(
            (fact) =>
              fact._tag === 'guest.feedback.submitted' &&
              fact.responseRevision !== response.feedbackSubmissionRevision,
          )
        ) {
          throw new Error('Guest response submission snapshot is required')
        }
        if (
          initialIntegrity.responseId !== response.id ||
          initialIntegrity.organizationId !== response.organizationId ||
          initialIntegrity.propertyId !== response.propertyId ||
          initialIntegrity.portalId !== response.portalId ||
          initialIntegrity.revision !== 1 ||
          initialIntegrity.previousOutcome !== null ||
          initialIntegrity.outcome !== response.integrityOutcome ||
          initialIntegrity.reasonCode !== response.integrityReasonCode ||
          initialIntegrity.decidedAt.getTime() !== response.submittedAt.getTime() ||
          initialIntegrity.decidedAt.getTime() !==
            response.integrityAssessedAt.getTime() ||
          !initialIntegrityFactsMatch(response, facts)
        ) {
          throw new Error('Guest response initial integrity decision is invalid')
        }
        const submittedAt = response.submittedAt
        const experienceSnapshot = response.experienceSnapshot
        if (
          binding.expiresAt.getTime() - submittedAt.getTime() !==
          DEFAULT_RESPONSE_SESSION_WINDOW_MS
        ) {
          return 'duplicate' as const
        }
        const submittedText = response.text
        const outcome = await db
          .transaction(async (tx) => {
            const sourceLineage = lineage(response, facts)
            const inserted = await tx
              .insert(guestResponses)
              .values({
                ...guestResponseToInsertRow(response, submittedAt),
                ...sourceLineage,
              })
              .onConflictDoNothing()
              .returning({ id: guestResponses.id })
            if (inserted.length === 0) throw new GuestCommandConflict()
            await tx.insert(guestResponseIntegrityDecisions).values({
              responseId: initialIntegrity.responseId,
              organizationId: initialIntegrity.organizationId,
              propertyId: initialIntegrity.propertyId,
              portalId: initialIntegrity.portalId,
              revision: initialIntegrity.revision,
              previousOutcome: initialIntegrity.previousOutcome,
              outcome: initialIntegrity.outcome,
              reasonCode: initialIntegrity.reasonCode,
              source: initialIntegrity.source,
              actorId: initialIntegrity.actorId,
              decidedAt: initialIntegrity.decidedAt,
              createdAt: initialIntegrity.decidedAt,
            })
            await tx.insert(guestResponseExperienceSnapshots).values({
              responseId: response.id,
              organizationId: response.organizationId,
              propertyId: response.propertyId,
              portalId: response.portalId,
              publicationState: experienceSnapshot.portalPublicationState,
              publicationSnapshotId: experienceSnapshot.portalPublicationSnapshotId,
              publicationVersion: experienceSnapshot.portalPublicationVersion,
              publicationDigest: experienceSnapshot.portalPublicationDigest,
              configurationDigest: experienceSnapshot.portalConfigurationDigest,
              guestLocale: experienceSnapshot.guestLocale,
              languagePackVersion: experienceSnapshot.languagePackVersion,
              privateFeedbackThreshold: experienceSnapshot.privateFeedbackThreshold,
              capturedAt: experienceSnapshot.capturedAt,
            })
            const bound = await tx
              .insert(guestResponseSessionBindings)
              .values({
                responseId: response.id,
                organizationId: response.organizationId,
                propertyId: response.propertyId,
                portalId: response.portalId,
                sessionId: binding.sessionId,
                expiresAt: binding.expiresAt,
                createdAt: submittedAt,
              })
              .onConflictDoNothing()
              .returning({ responseId: guestResponseSessionBindings.responseId })
            if (bound.length === 0) throw new GuestCommandConflict()
            if (submittedText) {
              const feedbackAt = response.feedbackSubmittedAt ?? submittedAt
              await tx.insert(guestResponsePrivateFeedback).values({
                responseId: response.id,
                organizationId: response.organizationId,
                propertyId: response.propertyId,
                portalId: response.portalId,
                body: submittedText,
                submittedAt: feedbackAt,
                expiresAt: privateFeedbackExpiry(feedbackAt),
                createdAt: feedbackAt,
              })
            }
            for (const fact of facts) await insertOutboxRow(tx, fact)
            return 'applied' as const
          })
          .catch((error: unknown) => {
            if (error instanceof GuestCommandConflict) return 'duplicate' as const
            throw error
          })
        return outcome
      }),

    commitCorrected: (previous, response, facts) =>
      trace('guest.commandStore.commitCorrected', async () => {
        if (
          !primaryStaffAttributionEquals(
            previous.staffAttribution,
            response.staffAttribution,
          ) ||
          !factsMatchStaffAttribution(response, facts) ||
          facts.some(
            (fact) =>
              (fact._tag === 'guest.feedback.submitted' ||
                fact._tag === 'guest.feedback.retracted') &&
              fact.responseRevision !== response.feedbackSubmissionRevision,
          )
        ) {
          throw new Error('Guest response correction changed Staff attribution')
        }
        const correctedAt = response.correctedAt ?? clock()
        const sourceLineage = lineage(response, facts)
        const outcome = await db.transaction(async (tx) => {
          const updated = await tx
            .update(guestResponses)
            .set({
              status: response.status,
              rating: response.rating,
              categoryId: response.category,
              responseConsent: response.responseConsent,
              textConsent: response.textConsent,
              mediaConsent: response.mediaConsent,
              correctionCount: response.correctionCount,
              correctedAt: response.correctedAt,
              ratingSourceEventId: sourceLineage.ratingSourceEventId,
              feedbackSourceEventId: sourceLineage.feedbackSourceEventId,
              updatedAt: correctedAt,
            })
            .where(
              and(
                eq(guestResponses.organizationId, response.organizationId),
                eq(guestResponses.propertyId, response.propertyId),
                eq(guestResponses.portalId, response.portalId),
                eq(guestResponses.id, response.id),
                sessionBindingExists(response, response.correctedAt ?? new Date(0)),
                eq(guestResponses.status, previous.status),
                eq(guestResponses.correctionCount, previous.correctionCount),
                previous.ratingSourceEventId
                  ? eq(guestResponses.ratingSourceEventId, previous.ratingSourceEventId)
                  : isNull(guestResponses.ratingSourceEventId),
                previous.feedbackSourceEventId
                  ? eq(
                      guestResponses.feedbackSourceEventId,
                      previous.feedbackSourceEventId,
                    )
                  : isNull(guestResponses.feedbackSourceEventId),
                isNull(guestResponses.deletedAt),
              ),
            )
            .returning({ id: guestResponses.id })
          if (!updated[0]) return 'conflict' as const
          for (const fact of facts) await insertOutboxRow(tx, fact)
          return 'applied' as const
        })
        return outcome
      }),

    commitIntegrityChanged: (previous, response, decision, facts) =>
      trace('guest.commandStore.commitIntegrityChanged', async () => {
        if (
          decision.responseId !== response.id ||
          decision.organizationId !== response.organizationId ||
          decision.propertyId !== response.propertyId ||
          decision.portalId !== response.portalId ||
          decision.revision !== response.integrityRevision ||
          decision.outcome !== response.integrityOutcome ||
          decision.reasonCode !== response.integrityReasonCode ||
          decision.decidedAt.getTime() !== response.integrityAssessedAt.getTime() ||
          decision.previousOutcome !== previous.integrityOutcome ||
          response.integrityRevision !== previous.integrityRevision + 1 ||
          response.organizationId !== previous.organizationId ||
          response.propertyId !== previous.propertyId ||
          response.portalId !== previous.portalId ||
          response.id !== previous.id ||
          !primaryStaffAttributionEquals(
            previous.staffAttribution,
            response.staffAttribution,
          ) ||
          !factsMatchStaffAttribution(response, facts) ||
          !integrityFactsMatch(previous, response, facts)
        ) {
          throw new Error('Guest response integrity decision does not match aggregate')
        }
        const sourceLineage = lineage(response, facts)
        const outcome = await db.transaction(async (tx) => {
          const updated = await tx
            .update(guestResponses)
            .set({
              integrityOutcome: response.integrityOutcome,
              integrityReasonCode: response.integrityReasonCode,
              integrityRevision: response.integrityRevision,
              integrityAssessedAt: response.integrityAssessedAt,
              ratingSourceEventId: sourceLineage.ratingSourceEventId,
              updatedAt: response.integrityAssessedAt,
            })
            .where(
              and(
                eq(guestResponses.organizationId, previous.organizationId),
                eq(guestResponses.propertyId, previous.propertyId),
                eq(guestResponses.portalId, previous.portalId),
                eq(guestResponses.id, previous.id),
                eq(guestResponses.integrityOutcome, previous.integrityOutcome),
                eq(guestResponses.integrityRevision, previous.integrityRevision),
                previous.ratingSourceEventId
                  ? eq(guestResponses.ratingSourceEventId, previous.ratingSourceEventId)
                  : isNull(guestResponses.ratingSourceEventId),
                isNull(guestResponses.deletedAt),
              ),
            )
            .returning({ id: guestResponses.id })
          if (!updated[0]) return 'conflict' as const
          await tx.insert(guestResponseIntegrityDecisions).values({
            responseId: decision.responseId,
            organizationId: decision.organizationId,
            propertyId: decision.propertyId,
            portalId: decision.portalId,
            revision: decision.revision,
            previousOutcome: decision.previousOutcome,
            outcome: decision.outcome,
            reasonCode: decision.reasonCode,
            source: decision.source,
            actorId: decision.actorId,
            decidedAt: decision.decidedAt,
            createdAt: decision.decidedAt,
          })
          for (const fact of facts) await insertOutboxRow(tx, fact)
          return 'applied' as const
        })
        return outcome
      }),

    commitFeedbackAdded: (response, fact) =>
      trace('guest.commandStore.commitFeedbackAdded', async () => {
        if (
          !response.text ||
          !response.feedbackSubmittedAt ||
          response.feedbackSubmissionRevision !== fact.responseRevision ||
          !primaryStaffAttributionEquals(response.staffAttribution, fact.staffAttribution)
        ) {
          return 'conflict' as const
        }
        const binding = requireSessionBinding(response)
        if (!binding) return 'conflict' as const
        const feedbackText = response.text
        const feedbackSubmittedAt = response.feedbackSubmittedAt
        if (
          binding.expiresAt.getTime() - feedbackSubmittedAt.getTime() !==
          DEFAULT_RESPONSE_SESSION_WINDOW_MS
        ) {
          return 'conflict' as const
        }
        const outcome = await db
          .transaction(async (tx) => {
            const content = await tx
              .insert(guestResponsePrivateFeedback)
              .values({
                responseId: response.id,
                organizationId: response.organizationId,
                propertyId: response.propertyId,
                portalId: response.portalId,
                body: feedbackText,
                submittedAt: feedbackSubmittedAt,
                expiresAt: privateFeedbackExpiry(feedbackSubmittedAt),
                createdAt: feedbackSubmittedAt,
              })
              .onConflictDoNothing()
              .returning({ responseId: guestResponsePrivateFeedback.responseId })
            if (!content[0]) throw new GuestCommandConflict()
            const updated = await tx
              .update(guestResponses)
              .set({
                textConsent: response.textConsent,
                feedbackSourceEventId: fact.eventId,
                feedbackSubmittedAt,
                feedbackSubmissionRevision: response.feedbackSubmissionRevision,
                updatedAt: feedbackSubmittedAt,
              })
              .where(
                and(
                  eq(guestResponses.organizationId, response.organizationId),
                  eq(guestResponses.propertyId, response.propertyId),
                  eq(guestResponses.portalId, response.portalId),
                  eq(guestResponses.id, response.id),
                  sessionBindingExists(response, feedbackSubmittedAt, false),
                  eq(guestResponses.status, response.status),
                  eq(guestResponses.rating, response.rating!),
                  eq(
                    guestResponses.privateFeedbackThreshold,
                    response.privateFeedbackThreshold!,
                  ),
                  eq(guestResponses.correctionCount, response.correctionCount),
                  response.ratingSourceEventId
                    ? eq(guestResponses.ratingSourceEventId, response.ratingSourceEventId)
                    : isNull(guestResponses.ratingSourceEventId),
                  isNull(guestResponses.feedbackSubmittedAt),
                  isNull(guestResponses.feedbackWithdrawnAt),
                  isNull(guestResponses.feedbackSourceEventId),
                  eq(guestResponses.textConsent, false),
                  isNull(guestResponses.deletedAt),
                ),
              )
              .returning({ id: guestResponses.id })
            if (!updated[0]) throw new GuestCommandConflict()
            const rebound = await tx
              .update(guestResponseSessionBindings)
              .set({
                expiresAt: binding.expiresAt,
                createdAt: feedbackSubmittedAt,
              })
              .where(
                and(
                  eq(guestResponseSessionBindings.responseId, response.id),
                  eq(
                    guestResponseSessionBindings.organizationId,
                    response.organizationId,
                  ),
                  eq(guestResponseSessionBindings.sessionId, binding.sessionId),
                  sql`${guestResponseSessionBindings.expiresAt} > ${feedbackSubmittedAt}`,
                ),
              )
              .returning({ responseId: guestResponseSessionBindings.responseId })
            if (!rebound[0]) throw new GuestCommandConflict()
            await insertOutboxRow(tx, fact)
            return 'applied' as const
          })
          .catch((error: unknown) => {
            if (error instanceof GuestCommandConflict) return 'conflict' as const
            throw error
          })
        return outcome
      }),

    commitFeedbackWithdrawn: (previous, response, fact) =>
      trace('guest.commandStore.commitFeedbackWithdrawn', async () => {
        if (
          !response.feedbackWithdrawnAt ||
          !previous.text ||
          previous.feedbackSubmissionRevision !== fact.responseRevision ||
          !primaryStaffAttributionEquals(
            previous.staffAttribution,
            response.staffAttribution,
          ) ||
          !primaryStaffAttributionEquals(response.staffAttribution, fact.staffAttribution)
        ) {
          return 'conflict' as const
        }
        const feedbackWithdrawnAt = response.feedbackWithdrawnAt ?? clock()
        const outcome = await db
          .transaction(async (tx) => {
            const updated = await tx
              .update(guestResponses)
              .set({
                textConsent: false,
                feedbackSourceEventId: null,
                feedbackWithdrawnAt: response.feedbackWithdrawnAt,
                updatedAt: feedbackWithdrawnAt,
              })
              .where(
                and(
                  eq(guestResponses.organizationId, previous.organizationId),
                  eq(guestResponses.propertyId, previous.propertyId),
                  eq(guestResponses.portalId, previous.portalId),
                  eq(guestResponses.id, previous.id),
                  sessionBindingExists(previous, response.feedbackWithdrawnAt!),
                  eq(guestResponses.status, previous.status),
                  eq(guestResponses.rating, previous.rating!),
                  eq(guestResponses.correctionCount, previous.correctionCount),
                  previous.ratingSourceEventId
                    ? eq(guestResponses.ratingSourceEventId, previous.ratingSourceEventId)
                    : isNull(guestResponses.ratingSourceEventId),
                  eq(
                    guestResponses.feedbackSourceEventId,
                    previous.feedbackSourceEventId!,
                  ),
                  eq(guestResponses.textConsent, true),
                  isNull(guestResponses.feedbackWithdrawnAt),
                  isNull(guestResponses.deletedAt),
                ),
              )
              .returning({ id: guestResponses.id })
            if (!updated[0]) throw new GuestCommandConflict()
            const purged = await tx
              .delete(guestResponsePrivateFeedback)
              .where(
                and(
                  eq(guestResponsePrivateFeedback.responseId, previous.id),
                  eq(
                    guestResponsePrivateFeedback.organizationId,
                    previous.organizationId,
                  ),
                  eq(guestResponsePrivateFeedback.body, previous.text!),
                ),
              )
              .returning({ responseId: guestResponsePrivateFeedback.responseId })
            if (!purged[0]) throw new GuestCommandConflict()
            await insertOutboxRow(tx, fact)
            return 'applied' as const
          })
          .catch((error: unknown) => {
            if (error instanceof GuestCommandConflict) return 'conflict' as const
            throw error
          })
        return outcome
      }),

    commitWithdrawn: (response, facts) =>
      trace('guest.commandStore.commitWithdrawn', async () => {
        if (!factsMatchStaffAttribution(response, facts)) {
          throw new Error('Guest response withdrawal changed Staff attribution')
        }
        const deletedAt = response.deletedAt ?? clock()
        const committed = await db.transaction(async (tx) => {
          const deleted = await tx
            .update(guestResponses)
            .set({
              status: 'deleted',
              rating: null,
              categoryId: null,
              responseConsent: false,
              textConsent: false,
              mediaConsent: false,
              ratingSourceEventId: null,
              feedbackSourceEventId: null,
              deletedAt: response.deletedAt,
              updatedAt: deletedAt,
            })
            .where(
              and(
                eq(guestResponses.organizationId, response.organizationId),
                eq(guestResponses.propertyId, response.propertyId),
                eq(guestResponses.portalId, response.portalId),
                eq(guestResponses.id, response.id),
                sessionBindingExists(response, response.deletedAt ?? new Date(0)),
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
          await tx
            .delete(guestResponsePrivateFeedback)
            .where(
              and(
                eq(guestResponsePrivateFeedback.responseId, response.id),
                eq(guestResponsePrivateFeedback.organizationId, response.organizationId),
              ),
            )
          const media = await tx
            .update(guestResponseMedia)
            .set({
              status: 'purge_pending',
              processingLease: null,
              publicUrl: null,
              readyAt: null,
              deletedAt: response.deletedAt,
              updatedAt: deletedAt,
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
        return committed
      }),
  }
}
