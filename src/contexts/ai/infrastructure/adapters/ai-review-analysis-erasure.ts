import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { clearGooglePrimaryCategoryForProperty } from '#/shared/db/google-primary-category-purge'
import type { AiAuthorizationLifecycleTrigger } from '../../replay/contracts'

export async function eraseRetiredDerivatives(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
  capabilities: ReadonlyArray<string>,
) {
  const reviewEnabled =
    input.authorizationState === 'enabled' && capabilities.includes('review_analysis')
  const sourceEpoch = reviewEnabled ? input.fence.sourceEpoch : -1
  const reviewEpoch = reviewEnabled ? input.fence.reviewAnalysisEpoch : -1

  await tx.execute(sql`
    WITH retired_settlements AS (
      DELETE FROM ai_property_aggregate_settlements
      WHERE organization_id = ${input.organizationId}
        AND property_id = ${input.propertyId}::uuid
        AND (source_epoch <> ${sourceEpoch} OR review_analysis_epoch <> ${reviewEpoch})
    )
    DELETE FROM ai_property_aggregate_contributions
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (source_epoch <> ${sourceEpoch} OR review_analysis_epoch <> ${reviewEpoch})
  `)
  await tx.execute(sql`
    DELETE FROM ai_property_aggregate_heads
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (source_epoch <> ${sourceEpoch} OR review_analysis_epoch <> ${reviewEpoch})
  `)
  await tx.execute(sql`
    DELETE FROM ai_review_analyses
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (
        source_epoch <> ${sourceEpoch}
        OR review_analysis_epoch <> ${reviewEpoch}
      )
  `)
  if (!reviewEnabled) await eraseReviewAnalysisV3Remainder(tx, input)
}

/**
 * What review analysis v3 keeps for a Property beside its analyses, and keeps across a
 * re-analysis: the Google category hint, per-Property issue groups (with their
 * spellings, merges and managers' names and hides). A new epoch leaves these alone: a group is stable across epochs so a manager's
 * rename, merge or hide survives a re-analysis. Turning review analysis off, revoking, or removing the capability
 * ends them with the rest: the merchant notice says turning a capability off and
 * erasure "cover everything listed under 'What review analysis keeps'".
 *
 * Runs in the transaction that deletes the analyses. The analyses' mentions go with
 * them (cascade), and so do the manager corrections beside those, so by the time the
 * groups go no mention names one; a mention's foreign key to its group is deferred to
 * commit for this reason. A group goes with its members and its merge redirects
 * (cascade). Re-enabling starts from nothing: the groups are made again by the
 * analysis.
 */
async function eraseReviewAnalysisV3Remainder(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
) {
  await clearGooglePrimaryCategoryForProperty(tx, input)
  await tx.execute(sql`
    DELETE FROM ai_property_issue_groups
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
  `)
}
