// The AI draft binding: an AI-assisted reply is only publishable while every
// input its draft was generated from is still the current one. WP3.3-B moved
// this from assert_current_ai_draft_binding_v1 (PL/pgSQL) into the same
// transaction as the write that depends on it. Explicit purges
// (src/shared/db/ai/ai-draft-purge.ts) withdraw drafts when a property, a
// Review's revision or source epoch, a profile, an authorization or a control
// changes; what is left to check here is the state those purges cannot see
// coming: the two expiries, the operation's settled receipt, and a
// confirmation that commits while a purge is running. A draft whose own expiry
// has passed stays refused here until the next observation of its Review
// withdraws it.
//
// The binding gates AI text on its way to Google and nothing else: submit,
// Confirm & Publish and the publish worker's claim read it
// (reply-write-guards.ts). Reject, delete, a retry and a draft save do not, and
// a draft save or an edit of a published reply makes the text the manager's own
// (domain/reply-ai-text.ts).
//
// The binding has two halves, and the claim tells them apart. One is time: the
// adoption window (`ai_draft_expires_at`). The other is everything the text
// was generated from. Text a worker claimed once passed both while they held,
// so a later claim of the same words does not wait on a window that has closed
// since (`aiDraftInputsAreCurrent`). A changed input is never excused: it is
// what the purges withdraw a reply for, and the claim refuses what a purge
// would have withdrawn.

import { and, eq, sql, type SQL } from 'drizzle-orm'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { replies } from '#/shared/db/schema'
import type { Tx } from '#/shared/outbox/commit'

const REPLY_DRAFTING_RUNTIME_PROFILE = 'reply-drafting-runtime-v1'

/** The binding's one conjunct that only time moves, and its absence. `draft`
 * is the reply row as `bindingHolds` names it. */
const WITHIN_ITS_ADOPTION_WINDOW = sql`draft.ai_draft_expires_at > transaction_timestamp()`
const WHATEVER_ITS_ADOPTION_WINDOW = sql`TRUE`

export type AiDraftBindingStatus = 'current' | 'not_ai' | 'stale'

/**
 * Lock the reply row and decide whether its AI provenance is still current.
 * Human-authored replies are `not_ai`; a stale binding means a caller that
 * moves the text toward Google must refuse (the draft is no longer the one the
 * merchant reviewed).
 */
export async function assertCurrentAiDraftBinding(
  tx: Tx,
  input: Readonly<{ organizationId: string; replyId: string }>,
): Promise<AiDraftBindingStatus> {
  const [reply] = await tx
    .select({
      authorship: replies.authorship,
      operationId: replies.originOperationId,
    })
    .from(replies)
    .where(
      and(
        eq(replies.organizationId, input.organizationId),
        eq(replies.id, input.replyId),
      ),
    )
    .limit(1)
    .for('update')
  if (!reply || reply.authorship !== 'ai_assisted' || !reply.operationId) {
    return 'not_ai'
  }
  return (await bindingHolds(tx, input, WITHIN_ITS_ADOPTION_WINDOW)) ? 'current' : 'stale'
}

/**
 * Whether an AI-assisted reply's binding holds apart from its adoption window:
 * everything its text was generated from is still the current one, whatever
 * `ai_draft_expires_at` says. False for a reply that is not AI-assisted. Takes
 * no lock of its own: its caller holds the row through
 * `assertCurrentAiDraftBinding` in the same transaction.
 */
export function aiDraftInputsAreCurrent(
  tx: Tx,
  input: Readonly<{ organizationId: string; replyId: string }>,
): Promise<boolean> {
  return bindingHolds(tx, input, WHATEVER_ITS_ADOPTION_WINDOW)
}

/** Everything the text was generated from, and `adoptionWindow`. */
async function bindingHolds(
  tx: Tx,
  input: Readonly<{ organizationId: string; replyId: string }>,
  adoptionWindow: SQL,
): Promise<boolean> {
  const current = await tx.execute<{ current: boolean }>(sql`
          SELECT EXISTS (
            SELECT 1
            FROM replies AS draft
            INNER JOIN reviews AS review
              ON review.id = draft.review_id
             AND review.organization_id = draft.organization_id
            INNER JOIN properties AS property
              ON property.id = review.property_id
             AND property.organization_id = draft.organization_id
            INNER JOIN ai_property_processing_profiles AS profile
              ON profile.property_id = property.id
             AND profile.organization_id = property.organization_id
            INNER JOIN merchant_ai_enablement AS merchant
              ON merchant.property_id = property.id
             AND merchant.organization_id = property.organization_id
            INNER JOIN ai_operations AS operation
              ON operation.id = draft.origin_operation_id
            WHERE draft.id = ${input.replyId}::uuid
              AND draft.organization_id = ${input.organizationId}
              AND property.deleted_at IS NULL
              AND property.lifecycle_state = 'active'
              AND property.source_epoch = draft.origin_source_epoch
              AND profile.lifecycle_state = 'active'
              AND profile.source_epoch = draft.origin_source_epoch
              AND profile.profile_version = draft.origin_property_profile_version
              AND review.source_epoch = draft.origin_source_epoch
              AND review.source_revision = draft.origin_source_revision
              AND review.content_expires_at > transaction_timestamp()
              AND ${adoptionWindow}
              AND merchant.state = 'enabled'
              AND merchant.authorized_source_epoch = draft.origin_source_epoch
              AND merchant.reply_drafting_epoch = draft.origin_reply_drafting_epoch
              AND merchant.capabilities @> ARRAY['reply_drafting']::text[]
              AND merchant.capability_runtime_profile_versions->>'reply_drafting'
                = ${REPLY_DRAFTING_RUNTIME_PROFILE}
              AND operation.command = 'reply'
              AND operation.capability = 'reply_drafting'
              AND operation.organization_id = draft.organization_id
              AND operation.property_id = property.id
              AND operation.review_id = review.id
              AND operation.source_epoch = draft.origin_source_epoch
              AND operation.source_revision = draft.origin_source_revision
              AND operation.property_profile_version = draft.origin_property_profile_version
              AND operation.state = 'succeeded'
              AND operation.budget_settled_at IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM ai_execution_control_heads AS control
                WHERE control.scope_key = 'global'
                  AND control.control_id = operation.global_control_id
                  AND control.generation = operation.global_control_generation
                  AND control.execution_state = 'enabled'
                  AND control.admission_state = 'accepting'
              )
              AND EXISTS (
                SELECT 1
                FROM ai_execution_control_heads AS control
                WHERE control.scope_key = 'provider:' || ${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}
                  AND control.control_id = operation.provider_control_id
                  AND control.generation = operation.provider_control_generation
                  AND control.execution_state = 'enabled'
                  AND control.admission_state = 'accepting'
              )
              AND EXISTS (
                SELECT 1
                FROM ai_execution_control_heads AS control
                WHERE control.scope_key = 'capability:reply_drafting'
                  AND control.control_id = operation.capability_control_id
                  AND control.generation = operation.capability_control_generation
                  AND control.execution_state = 'enabled'
                  AND control.admission_state = 'accepting'
              )
          ) AS "current"
        `)
  return current.rows[0]?.current === true
}
