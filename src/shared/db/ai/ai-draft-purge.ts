// AI draft purge: withdraw AI-assisted Replies whose inputs are no longer current.
//
// An AI-assisted Reply (`authorship = 'ai_assisted'`) still carries the unedited
// output of one AI operation; any manager edit makes it `human` and takes it
// out of this module's reach. It may be published only while everything it was
// generated from is current (the AI draft binding,
// src/contexts/review/infrastructure/ai-draft-binding.ts). The transaction that
// changes one of those inputs calls the purge for the scope it changed:
//
//   control        an AI execution control transition (every Organization)
//   authorization  a Merchant AI Authorization change (one Property)
//   profile        a processing-profile change (one Property)
//   property       a Property archive or a Google binding change (one Property)
//   organization   an Organization closing
//   review         a new Material Review Revision or source epoch, or erased
//                  source content (one Review). An observation that leaves the
//                  revision where it was changes nothing the Reply was written
//                  from, so the observation path must not call the purge for it.
//
// What happens to a Reply depends on how far it got (docs/BETA.md section 3 "AI",
// ADR 0031, ADR 0055 decision 6):
//
//   never confirmed
//       `publication_state IS NULL`: a draft, a Reply awaiting approval or a
//       rejected one that no manager ever confirmed. Nothing references the
//       row, so it is deleted.
//   confirmed, not dispatched
//       `requested` or `authorized`, and a Reply back in draft (or resubmitted,
//       or rejected) after a `cancelled` cycle. The publication authorization,
//       and any attempt, reference the row with ON DELETE RESTRICT and are
//       evidence that must survive, so the row stays. An open cycle is
//       cancelled the way a policy stop cancels one (the Reply returns to
//       `draft`, `publication_state = 'cancelled'`, the current attempt
//       `superseded`), so no worker can claim it. The AI-derived text is
//       emptied: the erased shape the Organization purge leaves a Reply it has
//       to keep. With no AI text left, the row stops claiming AI authorship.
//   dispatched or ended
//       `approved` with `sending`, `pending_observation` or `ambiguous`, and
//       `published` and `publish_failed` Replies. Left alone: the text may
//       already be on Google, and the publish worker, the reconciliation sweep
//       and Review's own cancellation paths own these rows.
//
// A Reply somebody was waiting on does not vanish silently. For each Reply that
// was awaiting approval, or confirmed and waiting to be sent, the purge records
// one `review.reply.publication_cancelled` fact (cause `ai_draft_withdrawn`) in
// the caller's transaction. A draft nobody was asked about goes without one.
//
// A confirmation that commits while the purge runs can slip past both
// statements. The publish worker's claim repeats the AI draft binding check, so
// such a Reply still cannot reach Google.
//
// The fact is built here, not by Review's constructor: the purge runs inside
// other contexts' transactions, and shared/db may not import a context. Its
// shape is checked against the registered event schema when it is inserted.

import { sql, type SQL } from 'drizzle-orm'
import { newEventId } from '#/shared/domain/event-id'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { AiBudgetTx } from './ai-budget'

type PropertyDraftScope = Readonly<{
  organizationId: string
  propertyId: string
}>

/** A withdrawn Reply as its cancellation fact names it: identifiers only. */
type WithdrawnReplyRow = {
  id: string
  review_id: string
  organization_id: string
  property_id: string
  author_id: string | null
  occurred_at: Date | string
}

const EVERY_ORGANIZATION = sql`TRUE`

const inProperty = (input: PropertyDraftScope): SQL => sql`
  review.property_id = ${input.propertyId}::uuid
  AND review.organization_id = ${input.organizationId}
`

async function recordWithdrawal(tx: AiBudgetTx, row: WithdrawnReplyRow): Promise<void> {
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
async function withdrawAiDrafts(tx: AiBudgetTx, scope: SQL): Promise<void> {
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

export function purgeAiDraftsForProperty(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
): Promise<void> {
  return withdrawAiDrafts(tx, inProperty(input))
}

export function purgeAiDraftsForProfile(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
): Promise<void> {
  return withdrawAiDrafts(tx, inProperty(input))
}

export function purgeAiDraftsForAuthorization(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
): Promise<void> {
  return withdrawAiDrafts(tx, inProperty(input))
}

export async function purgeAiDraftsForControl(
  tx: AiBudgetTx,
  scopeKind: 'global' | 'provider_deployment_profile' | 'capability',
  scopeValue: string | null,
): Promise<void> {
  if (
    scopeKind !== 'global' &&
    scopeKind !== 'provider_deployment_profile' &&
    !(scopeKind === 'capability' && scopeValue === 'reply_drafting')
  ) {
    return
  }
  await withdrawAiDrafts(tx, EVERY_ORGANIZATION)
}

export function purgeAiDraftsForOrganization(
  tx: AiBudgetTx,
  closingOrganizationId: string,
): Promise<void> {
  return withdrawAiDrafts(tx, sql`reply.organization_id = ${closingOrganizationId}`)
}

export function purgeAiDraftsForReview(
  tx: AiBudgetTx,
  input: Readonly<{ organizationId: string; reviewId: string }>,
): Promise<void> {
  return withdrawAiDrafts(
    tx,
    sql`reply.review_id = ${input.reviewId}::uuid
      AND reply.organization_id = ${input.organizationId}`,
  )
}
