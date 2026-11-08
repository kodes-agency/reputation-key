import { sql, type SQL } from 'drizzle-orm'
import { newEventId } from '#/shared/domain/event-id'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import {
  deleteOrganizationPublicationAttempts,
  releaseOrganizationAttemptConfirmations,
} from './row-commands.server'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'

/** A withdrawn Reply as its cancellation fact names it: identifiers only. */
type WithdrawnReplyRow = {
  id: string
  review_id: string
  organization_id: string
  property_id: string
  author_id: string | null
  occurred_at: Date | string
}

async function recordWithdrawal(tx: Tx, row: WithdrawnReplyRow): Promise<void> {
  await insertOutboxRow(tx, {
    _tag: 'review.reply.publication_cancelled',
    eventId: newEventId(),
    replyId: replyId(row.id),
    reviewId: reviewId(row.review_id),
    organizationId: organizationId(row.organization_id),
    propertyId: propertyId(row.property_id),
    authorId: row.author_id === null ? null : userId(row.author_id),
    cause: 'ai_draft_withdrawn',
    occurredAt: new Date(row.occurred_at),
    correlationId: null,
  })
}

/**
 * Withdraw every AI-assisted Reply in `scope` that has not been dispatched.
 * `scope` is a predicate over `reply` (replies) and `review` (its reviews row).
 * The delete returns every row it removed with its status; the second
 * statement returns only the Replies somebody was waiting on.
 *
 * The delete runs first on purpose: a confirmation that commits while it waits
 * on the row leaves `authorized` behind for the second statement's snapshot.
 */
export async function withdrawAiDrafts(tx: Tx, scope: SQL): Promise<void> {
  await lockReplyReviewsInScope(
    tx,
    sql`EXISTS (
    SELECT 1 FROM replies AS reply
    WHERE reply.review_id = review.id
      AND reply.organization_id = review.organization_id
      AND ${scope}
  )`,
  )
  const deleted = await tx.execute<WithdrawnReplyRow & { status: string }>(sql`
    DELETE FROM replies AS reply
    USING reviews AS review
    WHERE reply.review_id = review.id
      AND reply.organization_id = review.organization_id
      AND reply.authorship = 'ai_assisted'
      AND reply.publication_state IS NULL
      AND ${scope}
    RETURNING reply.id, reply.review_id, reply.organization_id, review.property_id,
      reply.status::text AS status,
      COALESCE(reply.submitted_by, reply.created_by) AS author_id,
      transaction_timestamp() AS occurred_at
  `)
  const emptied = await tx.execute<WithdrawnReplyRow>(sql`
    WITH held AS (
      SELECT reply.id, reply.review_id, reply.organization_id, review.property_id,
        reply.status::text AS status, reply.publication_state,
        reply.publication_cycle, reply.publication_attempts,
        COALESCE(reply.submitted_by, reply.created_by) AS author_id
      FROM replies AS reply
      INNER JOIN reviews AS review
        ON review.id = reply.review_id
       AND review.organization_id = reply.organization_id
      WHERE reply.authorship = 'ai_assisted'
        AND (
          reply.publication_state IN ('requested', 'authorized')
          OR (
            reply.publication_state = 'cancelled'
            AND reply.status IN ('draft', 'pending_approval', 'rejected')
          )
        )
        AND ${scope}
      FOR UPDATE OF reply
    ), emptied AS (
      UPDATE replies AS reply
      SET status = 'draft',
          publication_state = 'cancelled',
          publication_last_error_class = NULL,
          reconcile_due_at = NULL,
          rejected_by = NULL,
          rejection_reason = NULL,
          text = '',
          authorship = 'human',
          updated_at = transaction_timestamp()
      FROM held
      WHERE reply.id = held.id
        AND reply.organization_id = held.organization_id
    ), superseded AS (
      UPDATE reply_publication_attempts AS attempt
      SET outcome = 'superseded',
          confirmed_observation_revision = NULL,
          updated_at = transaction_timestamp()
      FROM held
      WHERE held.publication_state IN ('requested', 'authorized')
        AND attempt.organization_id = held.organization_id
        AND attempt.reply_id = held.id
        AND attempt.publication_cycle = held.publication_cycle
        AND attempt.attempt_number = held.publication_attempts
    )
    SELECT id, review_id, organization_id, property_id, author_id,
      transaction_timestamp() AS occurred_at
    FROM held
    WHERE publication_state IN ('requested', 'authorized')
       OR status = 'pending_approval'
  `)
  const awaited = [
    ...deleted.rows.filter((row) => row.status === 'pending_approval'),
    ...emptied.rows,
  ]
  for (const row of awaited) {
    await recordWithdrawal(tx, row)
  }
}

/** Restore fencing participates in the recovery owner's existing transaction. */
export async function fenceReplyPublicationsAfterRestore(tx: Tx) {
  await lockReplyReviewsInScope(
    tx,
    sql`EXISTS (
    SELECT 1 FROM replies reply WHERE reply.review_id = review.id
      AND reply.organization_id = review.organization_id
      AND reply.publication_state IN ('requested', 'authorized', 'sending')
  )`,
  )
  const repliesCanceled = await tx.execute(sql`
      UPDATE replies
      SET publication_state = 'cancelled',
          publication_last_error_class = NULL,
          reconcile_due_at = NULL,
          updated_at = clock_timestamp()
      WHERE publication_state IN ('requested', 'authorized')
      RETURNING id
    `)
  const repliesAmbiguous = await tx.execute(sql`
      UPDATE replies
      SET publication_state = 'ambiguous',
          publication_last_error_class = 'ambiguous',
          reconcile_due_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE publication_state = 'sending'
      RETURNING id
    `)
  return {
    cancelled: repliesCanceled.rows.length,
    ambiguous: repliesAmbiguous.rows.length,
  }
}

async function lockReplyReviewsInScope(tx: Tx, scope: SQL): Promise<void> {
  await tx.execute(sql`
    SELECT review.id FROM reviews AS review WHERE ${scope}
    ORDER BY review.organization_id, review.id FOR UPDATE OF review
  `)
}

export async function cancelRepliesForOrganizationClosing(
  tx: Tx,
  request: Readonly<{ organizationId: string; occurredAt: Date }>,
): Promise<number> {
  await lockReplyReviewsInScope(
    tx,
    sql`review.organization_id = ${request.organizationId}`,
  )
  const result = await tx.execute(sql`UPDATE replies
        SET publication_state = 'cancelled',
            status = 'draft',
            reconcile_due_at = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${request.organizationId}
          AND publication_state IN ('requested', 'authorized')`)
  return result.rowCount ?? 0
}

export async function scrubOrganizationReplyContent(
  tx: Tx,
  request: Readonly<{ organizationId: string; occurredAt: Date }>,
): Promise<number> {
  await lockReplyReviewsInScope(
    tx,
    sql`review.organization_id = ${request.organizationId}`,
  )
  const result = await tx.execute(sql`UPDATE replies
        SET text = '',
            rejection_reason = NULL,
            created_by = NULL,
            submitted_by = NULL,
            approved_by = NULL,
            rejected_by = NULL,
            reply_language_tag = NULL,
            reconcile_due_at = NULL,
            publication_last_error_class = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${request.organizationId}
          AND (text <> ''
               OR rejection_reason IS NOT NULL
               OR created_by IS NOT NULL
               OR submitted_by IS NOT NULL
               OR approved_by IS NOT NULL
               OR rejected_by IS NOT NULL
               OR reply_language_tag IS NOT NULL)`)
  return result.rowCount ?? 0
}

export function lockOrganizationReplyReviews(
  tx: Tx,
  organizationId: string,
): Promise<void> {
  return lockReplyReviewsInScope(tx, sql`review.organization_id = ${organizationId}`)
}

export const replyScopeEffects = {
  withdrawAiDrafts,
  fenceReplyPublicationsAfterRestore,
  cancelRepliesForOrganizationClosing,
  scrubOrganizationReplyContent,
  releaseOrganizationAttemptConfirmations,
  deleteOrganizationPublicationAttempts,
  lockOrganizationReplyReviews,
} as const
