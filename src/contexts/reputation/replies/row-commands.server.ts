import { and, eq, inArray, or, sql } from 'drizzle-orm'
import {
  replies,
  replyPublicationAttempts,
  replyPublicationAuthorizations,
} from '#/shared/db/schema/review.schema'
import type { Tx } from '#/shared/outbox/commit'
import type { PersistedPublicationState } from '#/contexts/review/application/public-api'

/**
 * Reply writes that need only the caller's transaction. Review's stores call
 * them under the Review lock they already hold; each one carries the snapshot
 * the row must still match, so it loses to any move it did not see.
 */

type ReplyRow = typeof replies.$inferSelect
type ReplyStatus = ReplyRow['status']
type ReplyRef = Readonly<{ id: string; organizationId: string }>

const NO_PENDING_PUBLICATION_CHECK = {
  publicationLastErrorClass: null,
  reconcileDueAt: null,
} as const

/** Removes the provider-mirror rows of one Review. Returns how many it removed. */
export async function deleteGoogleSyncMirrors(
  tx: Tx,
  scope: Readonly<{ organizationId: string; reviewId: string }>,
): Promise<number> {
  const removed = await tx
    .delete(replies)
    .where(
      and(
        eq(replies.organizationId, scope.organizationId),
        eq(replies.reviewId, scope.reviewId),
        eq(replies.source, 'google_sync'),
      ),
    )
    .returning({ id: replies.id })
  return removed.length
}

/**
 * Refreshes the provider mirror. Publication columns are deliberately not in
 * the conflict set: a mirror refresh never clobbers an in-flight publication.
 */
export async function upsertMirrorReply(
  tx: Tx,
  row: typeof replies.$inferInsert,
  updatedAt: Date,
): Promise<ReplyRow | undefined> {
  const [saved] = await tx
    .insert(replies)
    .values(row)
    .onConflictDoUpdate({
      target: [replies.reviewId, replies.source, replies.organizationId],
      set: {
        text: row.text,
        status: row.status,
        approvedBy: row.approvedBy,
        rejectedBy: row.rejectedBy,
        rejectionReason: row.rejectionReason,
        aiGenerated: row.aiGenerated,
        stateRevision: row.stateRevision,
        submittedAt: row.submittedAt,
        approvedAt: row.approvedAt,
        publishedAt: row.publishedAt,
        updatedAt,
      },
    })
    .returning()
  return saved
}

/** The draft state a Reply returns to when provider truth cancels its publication. */
const cancelledByProviderTruth = (observedAt: Date) => ({
  status: 'draft' as const,
  publicationState: 'cancelled' as const,
  ...NO_PENDING_PUBLICATION_CHECK,
  updatedAt: observedAt,
})

export type ProviderTruthCancellation = ReplyRef &
  Readonly<{
    observedAt: Date
    publicationCycle: number
  }> &
  (
    | Readonly<{
        kind: 'in_flight'
        publicationAttempts: number
        /** Statuses a publication can be cancelled from. */
        statuses: ReadonlyArray<ReplyStatus>
        /** Publication states that leave the attempt uncertain. */
        uncertainStates: ReadonlyArray<PersistedPublicationState>
        /** A terminal failure of unknown outcome is as uncertain as before. */
        includeTerminalAmbiguity: boolean
      }>
    | Readonly<{ kind: 'zero_attempt_authorization'; stateRevision: number }>
  )

/** Cancels the publication that fresh provider truth has overtaken. False when the row moved. */
export async function cancelReplyAtProviderTruth(
  tx: Tx,
  cancellation: ProviderTruthCancellation,
): Promise<boolean> {
  const common = and(
    eq(replies.id, cancellation.id),
    eq(replies.organizationId, cancellation.organizationId),
    eq(replies.publicationCycle, cancellation.publicationCycle),
  )
  const snapshot =
    cancellation.kind === 'zero_attempt_authorization'
      ? and(
          common,
          eq(replies.publicationAttempts, 0),
          eq(replies.stateRevision, cancellation.stateRevision),
          eq(replies.status, 'approved'),
          eq(replies.publicationState, 'authorized'),
        )
      : and(
          common,
          eq(replies.publicationAttempts, cancellation.publicationAttempts),
          inArray(replies.status, [...cancellation.statuses]),
          cancellation.includeTerminalAmbiguity
            ? or(
                inArray(replies.publicationState, [...cancellation.uncertainStates]),
                and(
                  eq(replies.publicationState, 'terminal'),
                  eq(replies.publicationLastErrorClass, 'ambiguous'),
                ),
              )
            : inArray(replies.publicationState, [...cancellation.uncertainStates]),
        )
  const cancelled = await tx
    .update(replies)
    .set(cancelledByProviderTruth(cancellation.observedAt))
    .where(snapshot)
    .returning({ id: replies.id })
  return cancelled.length > 0
}

/** Publishes the Reply whose text Google now shows. Null when the row moved. */
export async function confirmReplyPublished(
  tx: Tx,
  confirmation: ReplyRef &
    Readonly<{
      observedAt: Date
      publicationCycle: number
      statuses: ReadonlyArray<ReplyStatus>
      publicationStates: ReadonlyArray<PersistedPublicationState>
    }>,
): Promise<Readonly<{ id: string; stateRevision: number }> | null> {
  const [confirmed] = await tx
    .update(replies)
    .set({
      status: 'published',
      publicationState: 'published',
      publishedAt: confirmation.observedAt,
      reconcileDueAt: null,
      updatedAt: confirmation.observedAt,
    })
    .where(
      and(
        eq(replies.id, confirmation.id),
        eq(replies.organizationId, confirmation.organizationId),
        eq(replies.publicationCycle, confirmation.publicationCycle),
        inArray(replies.status, [...confirmation.statuses]),
        inArray(replies.publicationState, [...confirmation.publicationStates]),
      ),
    )
    .returning({ id: replies.id, stateRevision: replies.stateRevision })
  return confirmed ?? null
}

/** A Review's source changed under a requested or authorized publication: back to draft. */
export async function returnReplyToDraftForSourceChange(
  tx: Tx,
  stale: ReplyRef & Readonly<{ stateRevision: number; publicationCycle: number }>,
  activeStates: ReadonlyArray<PersistedPublicationState>,
  occurredAt: Date,
): Promise<boolean> {
  const returned = await tx
    .update(replies)
    .set({
      status: 'draft',
      publicationState: 'cancelled',
      ...NO_PENDING_PUBLICATION_CHECK,
      updatedAt: occurredAt,
    })
    .where(
      and(
        eq(replies.id, stale.id),
        eq(replies.organizationId, stale.organizationId),
        eq(replies.stateRevision, stale.stateRevision),
        eq(replies.publicationCycle, stale.publicationCycle),
        inArray(replies.publicationState, [...activeStates]),
      ),
    )
    .returning({ id: replies.id })
  return returned.length > 0
}

/** A guest edit takes a Reply back to the state its publication allows. */
export async function returnReplyAfterGuestEdit(
  tx: Tx,
  row: ReplyRef & Readonly<{ stateRevision: number }>,
  target: Readonly<{
    status: ReplyStatus
    publicationState: PersistedPublicationState | null
  }>,
  occurredAt: Date,
): Promise<boolean> {
  const returned = await tx
    .update(replies)
    .set({
      status: target.status,
      publicationState: target.publicationState,
      ...NO_PENDING_PUBLICATION_CHECK,
      updatedAt: occurredAt,
    })
    .where(
      and(
        eq(replies.id, row.id),
        eq(replies.organizationId, row.organizationId),
        eq(replies.stateRevision, row.stateRevision),
      ),
    )
    .returning({ id: replies.id })
  return returned.length > 0
}

/** Rewrites the draft an AI adoption replaces. */
export async function updateAdoptedAiDraft(
  tx: Tx,
  ref: ReplyRef,
  set: Partial<typeof replies.$inferInsert>,
): Promise<ReplyRow | undefined> {
  const [row] = await tx
    .update(replies)
    .set(set)
    .where(and(eq(replies.id, ref.id), eq(replies.organizationId, ref.organizationId)))
    .returning()
  return row
}

/** Inserts the draft an AI adoption creates. A Reply made since leaves it unwritten. */
export async function insertAdoptedAiDraft(
  tx: Tx,
  row: typeof replies.$inferInsert,
): Promise<ReplyRow | undefined> {
  const [inserted] = await tx
    .insert(replies)
    .values(row)
    .onConflictDoNothing({
      target: [replies.reviewId, replies.source, replies.organizationId],
    })
    .returning()
  return inserted
}

type AttemptRow = typeof replyPublicationAttempts.$inferInsert

/** Appends the evidence row of a claimed publication attempt. */
export async function insertPublicationAttempt(tx: Tx, row: AttemptRow): Promise<void> {
  await tx.insert(replyPublicationAttempts).values(row)
}

/**
 * Closes the Reply's newest attempt as superseded. It stays as append-only
 * evidence of what was tried. A cycle no worker claimed has no attempt to close.
 */
export async function supersedeCurrentPublicationAttempt(
  tx: Tx,
  reply: Readonly<{
    id: string
    organizationId: string
    publicationCycle: number
    publicationAttempts: number
  }>,
  occurredAt: Date,
): Promise<void> {
  if (reply.publicationAttempts < 1) return
  await tx
    .update(replyPublicationAttempts)
    .set({
      outcome: 'superseded',
      confirmedObservationRevision: null,
      updatedAt: occurredAt,
    })
    .where(
      and(
        eq(replyPublicationAttempts.organizationId, reply.organizationId),
        eq(replyPublicationAttempts.replyId, reply.id),
        eq(replyPublicationAttempts.publicationCycle, reply.publicationCycle),
        eq(replyPublicationAttempts.attemptNumber, reply.publicationAttempts),
      ),
    )
}

/**
 * Supersedes one attempt by id while it is still in one of `fromOutcomes`.
 * False when the attempt moved first.
 */
export async function supersedePublicationAttemptById(
  tx: Tx,
  attempt: Readonly<{ id: string; organizationId: string }>,
  fromOutcomes: ReadonlyArray<AttemptRow['outcome'] & string>,
  occurredAt: Date,
): Promise<boolean> {
  const rows = await tx
    .update(replyPublicationAttempts)
    .set({
      outcome: 'superseded',
      confirmedObservationRevision: null,
      updatedAt: occurredAt,
    })
    .where(
      and(
        eq(replyPublicationAttempts.id, attempt.id),
        eq(replyPublicationAttempts.organizationId, attempt.organizationId),
        inArray(replyPublicationAttempts.outcome, [...fromOutcomes]),
      ),
    )
    .returning({ id: replyPublicationAttempts.id })
  return rows.length > 0
}

/** Marks an attempt confirmed by the provider observation that echoed its text. */
export async function confirmPublicationAttempt(
  tx: Tx,
  attempt: Readonly<{ id: string; organizationId: string }>,
  observationRevision: number,
  occurredAt: Date,
): Promise<void> {
  await tx
    .update(replyPublicationAttempts)
    .set({
      outcome: 'confirmed',
      confirmedObservationRevision: observationRevision,
      updatedAt: occurredAt,
    })
    .where(
      and(
        eq(replyPublicationAttempts.id, attempt.id),
        eq(replyPublicationAttempts.organizationId, attempt.organizationId),
      ),
    )
}

/**
 * Organization purge, step one: release every confirmation link so the
 * attempt and observation rows, which reference each other with RESTRICT keys,
 * can be deleted. `superseded` satisfies the confirmation check constraint.
 */
export async function releaseOrganizationAttemptConfirmations(
  tx: Tx,
  request: Readonly<{ organizationId: string; occurredAt: Date }>,
): Promise<number> {
  const result = await tx.execute(
    sql`UPDATE reply_publication_attempts
        SET outcome = 'superseded',
            confirmed_observation_revision = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${request.organizationId}
          AND confirmed_observation_revision IS NOT NULL`,
  )
  return result.rowCount ?? 0
}

/** Organization purge, last step: the attempt rows, with their provider operation identifiers. */
export async function deleteOrganizationPublicationAttempts(
  tx: Tx,
  organizationId: string,
): Promise<number> {
  const result = await tx.execute(
    sql`DELETE FROM reply_publication_attempts WHERE organization_id = ${organizationId}`,
  )
  return result.rowCount ?? 0
}

export async function releasePropertyAttemptConfirmations(
  tx: Tx,
  request: Readonly<{ organizationId: string; propertyId: string; occurredAt: Date }>,
): Promise<number> {
  const result = await tx.execute(
    sql`UPDATE reply_publication_attempts
        SET outcome = 'superseded',
            confirmed_observation_revision = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${request.organizationId}
          AND property_id = ${request.propertyId}
          AND confirmed_observation_revision IS NOT NULL`,
  )
  return result.rowCount ?? 0
}

/** Property purge, last step: the Property's attempt rows. */
export async function deletePropertyPublicationAttempts(
  tx: Tx,
  request: Readonly<{ organizationId: string; propertyId: string }>,
): Promise<number> {
  const result = await tx.execute(
    sql`DELETE FROM reply_publication_attempts
        WHERE organization_id = ${request.organizationId}
          AND property_id = ${request.propertyId}`,
  )
  return result.rowCount ?? 0
}

/** Records the authorization a manager gave to publish one exact reply text. */
export async function insertPublicationAuthorization(
  tx: Tx,
  row: typeof replyPublicationAuthorizations.$inferInsert,
): Promise<void> {
  await tx.insert(replyPublicationAuthorizations).values(row)
}
