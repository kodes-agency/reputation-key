// AI's Organization erasure: the retained derivatives, deleted in
// foreign-key-safe order. The rights executor runs it behind its journal entry.

import { sql } from 'drizzle-orm'
import { clearGooglePrimaryCategoryForOrganization } from '#/shared/db/google-primary-category-purge'
import type { Tx } from '#/shared/outbox/commit'

/**
 * Retained AI derivatives and the ledgers that could rebuild them, in
 * foreign-key-safe order (children before parents). The Review Analysis v3 mention
 * tables are not listed: they cascade from `ai_review_analyses` and from
 * `ai_property_aggregate_contributions`. Contribution mentions must disappear
 * before their referenced issue groups; members then precede groups.
 *
 * The ordering is not cosmetic: derivative rows are deleted before the
 * operation records they reference. Erasure also removes enrollment and
 * aggregate heads so a later sweep cannot rebuild the derivative.
 */
export const AI_PURGE_DELETE_TABLES = Object.freeze([
  'ai_draft_measurements',
  'ai_review_analysis_backlog',
  'ai_review_analysis_enrollments',
  'ai_property_aggregate_contributions',
  'ai_property_issue_members',
  'ai_property_issue_groups',
  'ai_property_aggregate_settlements',
  'ai_property_aggregate_heads',
  'ai_review_analyses',
  'ai_organization_cost_windows',
  'ai_operations',
  'ai_property_processing_profiles',
] as const)

/**
 * Irreversible, idempotent, content-free.
 *
 * Two AI-owned tables are deliberately NOT deleted here:
 *
 * - `merchant_ai_consent_evidence` is `recoverable_archive` in the data-fate
 *   authority: it is the append-only proof of what the merchant consented to,
 *   it holds no review text, guest content or provider identifier, and an
 *   append-only guard trigger refuses to delete it anyway. It is independently
 *   retained evidence, so this phase leaves it alone.
 * - `merchant_ai_enablement` cannot be deleted by any statement outside the
 *   Identity-owned transition function (`merchant_ai_head_cannot_be_deleted`).
 *   It is removed by the schema's own ON DELETE CASCADE when Property purges
 *   the `properties` rows it hangs off, which is the only path the schema
 *   permits.
 *
 * The Property's Google category hint is cleared with the results that used it.
 * Source Reviews stay Review's to purge; consent evidence remains with Identity.
 */
export const eraseAiOrganizationRows = async (
  tx: Tx,
  organizationId: string,
): Promise<number> => {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('ai-draft-measurement'), hashtext(${organizationId}))`,
  )
  let deleted = 0
  for (const table of AI_PURGE_DELETE_TABLES) {
    const result = await tx.execute(
      sql`DELETE FROM ${sql.identifier(table)}
          WHERE organization_id = ${organizationId}
          RETURNING 1`,
    )
    deleted += result.rows.length
  }

  await clearGooglePrimaryCategoryForOrganization(tx, organizationId)
  return deleted
}
