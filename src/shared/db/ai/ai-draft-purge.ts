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
//   profile        a processing-profile, archive or Google binding change (one Property)
//   property       a Property deletion
//   organization   an Organization closing
//   review         a new Material Review Revision or source epoch, or erased
//                  source content (one Review). When a guest edit also stops a
//                  cycle the worker had claimed, Review calls the purge again
//                  after that stop, so the Reply it returned to draft is
//                  emptied in the same transaction.
//
// Measurement metadata survives input/control changes and Organization closing.
// Only consent withdrawal, Property deletion and irreversible Organization purge
// erase it; operation deletion also cascades its metadata retention.
//
// One input changes without a transaction: time. The binding ends when
// `ai_draft_expires_at` passes (the adoption window,
// AI_REPLY_ADOPTION_WINDOW_MILLIS after the suggestion was issued), and from
// then on the Reply can never be approved or published, while it still holds
// the Review's one internal Reply. Nothing runs at that instant, so the next
// observation of the Review does the work:
//
//   expiry         every observation of a known Review that is not a replay
//                  and does not move the revision withdraws that Review's
//                  AI-assisted Replies whose time has run out, and only those.
//                  A Reply whose binding is still current is not touched: the
//                  observation changed nothing it was written from.
//
// What happens to a Reply depends on how far it got (docs/BETA.md section 3 "AI",
// ADR 0031, ADR 0055 decision 6):
//
//   never confirmed
//       `publication_state IS NULL`: a draft, a Reply awaiting approval or a
//       rejected one that no manager ever confirmed. Nothing references the
//       row, so it is deleted.
//   confirmed, not dispatched
//       `requested` or `authorized` (a cycle requeued after a retryable
//       failure included: nothing was posted), and a Reply back in draft (or
//       resubmitted, or rejected) after a `cancelled` cycle. The publication
//       authorization, and any attempt, reference the row with ON DELETE
//       RESTRICT and are evidence that must survive, so the row stays. An open
//       cycle is cancelled the way a policy stop cancels one (the Reply returns
//       to `draft`, `publication_state = 'cancelled'`, the current attempt
//       `superseded`), so no worker can claim it. The AI-derived text is
//       emptied: the erased shape the Organization purge leaves a Reply it has
//       to keep. With no AI text left, the row stops claiming AI authorship,
//       and a manager can write a new reply into it.
//   dispatched or ended
//       `approved` with `sending`, `pending_observation` or `ambiguous`, and
//       `published` and `publish_failed` Replies. Left alone. A dispatched
//       cycle's text may already be on Google, and the publish worker, the
//       reconciliation sweep and Review's own cancellation paths own the row;
//       once one of them returns it to draft it is the shape above. A
//       `publish_failed` Reply is a cycle that ran to its end: the failure
//       notice and the attempt evidence describe that text, and an unconfirmed
//       one may be live. Its Retry authorizes a new cycle without reading the
//       binding (a failed Reply has no other command), and the claim of that
//       cycle withdraws the Reply unless the binding is current, or its text
//       was claimed once before and only the adoption window has passed since
//       (reputation/replies/store.server.ts, `aiTextMayBeClaimed`). So after any change
//       this purge runs for, a failed Reply's AI text is not sent again.
//
// A Reply somebody was waiting on does not vanish silently. For each Reply that
// was awaiting approval, or confirmed and waiting to be sent, the purge records
// one `review.reply.publication_cancelled` fact (cause `ai_draft_withdrawn`) in
// the caller's transaction. A draft nobody was asked about goes without one,
// and so does a Reply another cancellation already announced.
//
// A withdrawn Reply cannot be claimed. A publish job that read the row before
// the purge holds a copy the binding check no longer recognises as AI-assisted,
// so what stops it is the claim's compare-and-set on status, publication state
// and state revision, all of which the purge moves. A confirmation that commits
// while the purge runs can slip past both statements; that Reply is still
// AI-assisted, and the claim's binding check refuses it. A claim that refuses
// AI text withdraws the Reply itself, through `purgeAiDraftsForReview`, with
// this module's cause (review/infrastructure/unclaimable-publication.ts): the
// purge and the claim leave one shape, whichever reaches the Reply first.
//
// The purge empties a draft in place. A draft whose cycle was cancelled has
// the same status, publication state and cycle afterwards, so a reply command
// that puts text forward (submit, approve, retry, edit) also compares the
// state revision, which the emptying advances (reputation/replies/store.server.ts). A draft
// save also names its revision, so a stale browser cannot restore withdrawn text.
//
// The reply writer locks each affected Review before touching its Replies.
// Scope commands and measurement erasure remain in this caller's transaction.

import { sql, type SQL } from 'drizzle-orm'
import {
  requireReplyScopeEffects,
  type ReplyScopeEffects,
} from '#/shared/db/reply-scope-effects'
import type { AiBudgetTx } from './ai-budget'

type PropertyDraftScope = Readonly<{
  organizationId: string
  propertyId: string
}>

type ReviewDraftScope = Readonly<{
  organizationId: string
  reviewId: string
}>

const EVERY_ORGANIZATION = sql`TRUE`

const inProperty = (input: PropertyDraftScope): SQL => sql`
  review.property_id = ${input.propertyId}::uuid
  AND review.organization_id = ${input.organizationId}
`

const inReview = (input: ReviewDraftScope): SQL => sql`
  reply.review_id = ${input.reviewId}::uuid
  AND reply.organization_id = ${input.organizationId}
`

const withdraw = async (
  tx: AiBudgetTx,
  effects: ReplyScopeEffects | undefined,
  scope: SQL,
): Promise<void> => requireReplyScopeEffects(effects).withdrawAiDrafts(tx, scope)

/**
 * Withdrawing first takes each Review before any measurement is touched, the
 * order a submit follows; erasing the measurements first would hold them while
 * waiting for a Review a submit already holds.
 * (`reply-draft-races.integration.test.ts` fails when the order is reversed.)
 */
async function erasePropertyDraftMeasurements(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
  effects: ReplyScopeEffects | undefined,
): Promise<void> {
  await withdraw(tx, effects, inProperty(input))
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('ai-draft-measurement'), hashtext(${input.organizationId}))`,
  )
  await tx.execute(
    sql`DELETE FROM ai_draft_measurements WHERE organization_id = ${input.organizationId} AND property_id = ${input.propertyId}::uuid`,
  )
}

export function purgeAiDraftsForProperty(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
  effects: ReplyScopeEffects | undefined,
): Promise<void> {
  return erasePropertyDraftMeasurements(tx, input, effects)
}

export function purgeAiDraftsForProfile(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
  effects: ReplyScopeEffects | undefined,
): Promise<void> {
  return withdraw(tx, effects, inProperty(input))
}

export function purgeAiDraftsForAuthorization(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
  effects: ReplyScopeEffects | undefined,
): Promise<void> {
  return erasePropertyDraftMeasurements(tx, input, effects)
}

export async function purgeAiDraftsForControl(
  tx: AiBudgetTx,
  scopeKind: 'global' | 'provider_deployment_profile' | 'capability',
  scopeValue: string | null,
  effects: ReplyScopeEffects | undefined,
): Promise<void> {
  if (
    scopeKind !== 'global' &&
    scopeKind !== 'provider_deployment_profile' &&
    !(scopeKind === 'capability' && scopeValue === 'reply_drafting')
  ) {
    return
  }
  await withdraw(tx, effects, EVERY_ORGANIZATION)
}

export async function purgeAiDraftsForOrganization(
  tx: AiBudgetTx,
  closingOrganizationId: string,
  effects: ReplyScopeEffects | undefined,
): Promise<void> {
  await withdraw(tx, effects, sql`reply.organization_id = ${closingOrganizationId}`)
}

export async function purgeAiDraftsForReview(
  tx: AiBudgetTx,
  input: ReviewDraftScope,
  effects: ReplyScopeEffects | undefined,
): Promise<void> {
  await withdraw(tx, effects, inReview(input))
}

/**
 * The `expiry` scope: only the Review's AI-assisted Replies whose binding has
 * run out of time. The comparison is the complement of the binding check's
 * (`ai_draft_expires_at > transaction_timestamp()`), so a Reply is withdrawn
 * here exactly when that check would call it stale for its age.
 */
export function purgeExpiredAiDraftsForReview(
  tx: AiBudgetTx,
  input: ReviewDraftScope,
  effects: ReplyScopeEffects | undefined,
): Promise<void> {
  return withdraw(
    tx,
    effects,
    sql`${inReview(input)}
      AND reply.ai_draft_expires_at <= transaction_timestamp()`,
  )
}
