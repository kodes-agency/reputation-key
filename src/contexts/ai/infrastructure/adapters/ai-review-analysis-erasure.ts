import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { clearGooglePrimaryCategoryForProperty } from '#/shared/db/google-primary-category-purge'
import type { AiAuthorizationLifecycleTrigger } from '../../application/ports/ai-review-analysis-enrollment.port'

export async function eraseRetiredDerivatives(
  tx: Tx,
  input: AiAuthorizationLifecycleTrigger,
  capabilities: ReadonlyArray<string>,
) {
  const reviewEnabled =
    input.authorizationState === 'enabled' && capabilities.includes('review_analysis')
  const trendsEnabled = reviewEnabled && capabilities.includes('property_trends')
  const sourceEpoch = reviewEnabled ? input.fence.sourceEpoch : -1
  const reviewEpoch = reviewEnabled ? input.fence.reviewAnalysisEpoch : -1
  const trendEpoch = trendsEnabled ? input.fence.propertyTrendsEpoch : -1

  await tx.execute(sql`
    DELETE FROM ai_property_trend_outcomes AS outcome
    USING ai_property_trend_schedules AS schedule
    WHERE outcome.schedule_id = schedule.id
      AND schedule.organization_id = ${input.organizationId}
      AND schedule.property_id = ${input.propertyId}::uuid
      AND (
        schedule.source_epoch <> ${sourceEpoch}
        OR schedule.review_analysis_epoch <> ${reviewEpoch}
        OR schedule.property_trends_epoch <> ${trendEpoch}
      )
  `)
  await tx.execute(sql`
    DELETE FROM ai_property_trend_schedules
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (
        source_epoch <> ${sourceEpoch}
        OR review_analysis_epoch <> ${reviewEpoch}
        OR property_trends_epoch <> ${trendEpoch}
      )
  `)
  await tx.execute(sql`
    DELETE FROM ai_property_aggregate_contribution_aspects AS aspect
    USING ai_property_aggregate_contributions AS contribution
    WHERE aspect.organization_id = contribution.organization_id
      AND aspect.property_id = contribution.property_id
      AND aspect.review_id = contribution.review_id
      AND aspect.source_epoch = contribution.source_epoch
      AND aspect.source_revision = contribution.source_revision
      AND aspect.analysis_sequence = contribution.analysis_sequence
      AND contribution.organization_id = ${input.organizationId}
      AND contribution.property_id = ${input.propertyId}::uuid
      AND (
        contribution.source_epoch <> ${sourceEpoch}
        OR contribution.review_analysis_epoch <> ${reviewEpoch}
      )
  `)
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
    DELETE FROM ai_property_daily_aspect_aggregates
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND (source_epoch <> ${sourceEpoch} OR review_analysis_epoch <> ${reviewEpoch})
  `)
  await tx.execute(sql`
    DELETE FROM ai_property_daily_aggregates
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
    DELETE FROM ai_review_analysis_aspects AS aspect
    USING ai_review_analyses AS analysis
    WHERE aspect.organization_id = analysis.organization_id
      AND aspect.property_id = analysis.property_id
      AND aspect.review_id = analysis.review_id
      AND aspect.source_epoch = analysis.source_epoch
      AND aspect.source_revision = analysis.source_revision
      AND aspect.analysis_sequence = analysis.analysis_sequence
      AND analysis.organization_id = ${input.organizationId}
      AND analysis.property_id = ${input.propertyId}::uuid
      AND (
        analysis.source_epoch <> ${sourceEpoch}
        OR analysis.review_analysis_epoch <> ${reviewEpoch}
      )
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
 * spellings, merges and managers' names and hides), and daily counts of reviews by
 * star rating. A new epoch leaves these alone: a group is stable across epochs so a manager's
 * rename, merge or hide survives a re-analysis, and a day's count follows the reviews,
 * not an analysis. Turning review analysis off, revoking, or removing the capability
 * ends them with the rest: the merchant notice says turning a capability off and
 * erasure "cover everything listed under 'What review analysis keeps'".
 *
 * Runs in the transaction that deletes the analyses. The analyses' mentions go with
 * them (cascade), and so do the manager corrections beside those, so by the time the
 * groups go no mention names one; a mention's foreign key to its group is deferred to
 * commit for this reason. A group goes with its members and its merge redirects
 * (cascade). Re-enabling starts from nothing: the groups are made again by the
 * analysis, and the star counts by the Review projection and its backfill.
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
  await tx.execute(sql`
    DELETE FROM ai_property_review_population_daily
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
  `)
}
