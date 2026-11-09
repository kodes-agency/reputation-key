import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { aiPropertyAggregateHeads } from '#/shared/db/schema'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GuestVoiceFactsScope } from '../../application/ports/ai-guest-voice-facts.port'
import { lockAggregateHead } from './ai-property-aggregate-head'
import { lockReviewAnalysisPropertyFence } from './review-analysis-property-fence'

// Contributions are keyed by source sequence, independently of the processing
// profile. Moving their projection preserves mentions, corrections and paid
// provenance. A row still on an older profile is the durable pending work.
function pendingContribution(scope: GuestVoiceFactsScope): SQL {
  return sql`
    contribution.organization_id = ${scope.organizationId}
    AND contribution.property_id = ${scope.propertyId}::uuid
    AND contribution.source_epoch = ${scope.sourceEpoch}
    AND contribution.review_analysis_epoch = ${scope.reviewAnalysisEpoch}
    AND contribution.property_profile_version <> ${scope.propertyProfileVersion}
    AND EXISTS (
      SELECT 1 FROM ai_property_aggregate_settlements AS settlement
      WHERE settlement.organization_id = contribution.organization_id
        AND settlement.property_id = contribution.property_id
        AND settlement.source_epoch = contribution.source_epoch
        AND settlement.review_analysis_epoch = contribution.review_analysis_epoch
        AND settlement.review_id = contribution.review_id
        AND settlement.analysis_sequence = contribution.analysis_sequence
    )
    AND NOT EXISTS (
      SELECT 1 FROM ai_property_aggregate_settlements AS newer
      WHERE newer.organization_id = contribution.organization_id
        AND newer.property_id = contribution.property_id
        AND newer.source_epoch = contribution.source_epoch
        AND newer.review_analysis_epoch = contribution.review_analysis_epoch
        AND newer.review_id = contribution.review_id
        AND newer.analysis_sequence > contribution.analysis_sequence
    )
    AND EXISTS (
      SELECT 1 FROM reviews AS review
      WHERE review.organization_id = contribution.organization_id
        AND review.property_id = contribution.property_id
        AND review.id = contribution.review_id
        AND review.source_epoch = contribution.source_epoch
        AND review.source_revision = contribution.source_revision
        AND review.analysis_sequence = contribution.analysis_sequence
        AND review.source_content_state = 'active'
        AND ai_property_local_date_v1(review.reviewed_at, profile.timezone) IS NOT NULL
    )
  `
}

function headKey(scope: GuestVoiceFactsScope) {
  return and(
    eq(aiPropertyAggregateHeads.organizationId, scope.organizationId),
    eq(aiPropertyAggregateHeads.propertyId, scope.propertyId),
    eq(aiPropertyAggregateHeads.sourceEpoch, scope.sourceEpoch),
    eq(aiPropertyAggregateHeads.reviewAnalysisEpoch, scope.reviewAnalysisEpoch),
    eq(aiPropertyAggregateHeads.propertyProfileVersion, scope.propertyProfileVersion),
  )
}

async function currentProfile(tx: Tx, scope: GuestVoiceFactsScope) {
  const result = await tx.execute<{ timezone: string }>(sql`
    SELECT profile.timezone
    FROM ai_property_processing_profiles AS profile
    INNER JOIN merchant_ai_enablement AS enablement
      ON enablement.organization_id = profile.organization_id
     AND enablement.property_id = profile.property_id
    INNER JOIN properties AS property ON property.id = profile.property_id
      AND property.organization_id = profile.organization_id
    WHERE profile.organization_id = ${scope.organizationId}
      AND profile.property_id = ${scope.propertyId}::uuid
      AND profile.source_epoch = ${scope.sourceEpoch}
      AND profile.profile_version = ${scope.propertyProfileVersion}
      AND profile.lifecycle_state = 'active'
      AND property.source_epoch = profile.source_epoch
      AND property.lifecycle_state = 'active' AND property.deleted_at IS NULL
      AND enablement.state = 'enabled'
      AND enablement.authorized_source_epoch = profile.source_epoch
      AND enablement.review_analysis_epoch = ${scope.reviewAnalysisEpoch}
      AND enablement.capabilities @> ARRAY['review_analysis']::text[]
    FOR SHARE OF profile, enablement
  `)
  return result.rows[0]
}

// The worker enumerates identifiers only; rebuilding rechecks each tenant's authority.
// Properties are found from the processing profile and the authorization, not from
// the heads: a Property that rolled before heads were created at rollover has none
// for its current profile, and rebuilding creates it.
async function listPendingProfileRebuilds(db: Database, propertyLimit: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`)
    return tx.execute<GuestVoiceFactsScope>(sql`
      SELECT profile.organization_id AS "organizationId", profile.property_id AS "propertyId",
        profile.source_epoch AS "sourceEpoch", enablement.review_analysis_epoch AS "reviewAnalysisEpoch",
        profile.profile_version AS "propertyProfileVersion"
      FROM ai_property_processing_profiles AS profile
      INNER JOIN merchant_ai_enablement AS enablement
        ON enablement.organization_id = profile.organization_id
       AND enablement.property_id = profile.property_id
       AND enablement.state = 'enabled'
       AND enablement.authorized_source_epoch = profile.source_epoch
       AND enablement.capabilities @> ARRAY['review_analysis']::text[]
      LEFT JOIN ai_property_aggregate_heads AS head
        ON head.organization_id = profile.organization_id AND head.property_id = profile.property_id
       AND head.source_epoch = profile.source_epoch
       AND head.review_analysis_epoch = enablement.review_analysis_epoch
       AND head.property_profile_version = profile.profile_version
      WHERE profile.lifecycle_state = 'active'
      AND (
        EXISTS (
          SELECT 1 FROM ai_property_aggregate_heads AS older
          WHERE older.organization_id = profile.organization_id AND older.property_id = profile.property_id
            AND older.source_epoch = profile.source_epoch
            AND older.review_analysis_epoch = enablement.review_analysis_epoch
            AND older.property_profile_version < profile.profile_version
        ) OR EXISTS (
          SELECT 1 FROM ai_property_aggregate_contributions AS older
          WHERE older.organization_id = profile.organization_id AND older.property_id = profile.property_id
            AND older.source_epoch = profile.source_epoch
            AND older.review_analysis_epoch = enablement.review_analysis_epoch
            AND older.property_profile_version < profile.profile_version
        )
      ) AND COALESCE(head.settled_analysis_count, 0) < (
        SELECT count(*) FROM ai_property_aggregate_settlements AS settlement
        WHERE settlement.organization_id = profile.organization_id AND settlement.property_id = profile.property_id
          AND settlement.source_epoch = profile.source_epoch
          AND settlement.review_analysis_epoch = enablement.review_analysis_epoch
      )
      ORDER BY COALESCE(head.updated_at, '-infinity'::timestamptz), profile.property_id
      LIMIT ${propertyLimit}
    `)
  })
}

export function createAiProfileRebuild(db: Database, logger?: Pick<LoggerPort, 'warn'>) {
  async function rebuildProperty(
    scope: GuestVoiceFactsScope,
    limit = 100,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('Invalid profile rebuild batch size')
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '1s'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`)
      // Same order as Review and merchant transitions: Property before rows.
      await lockReviewAnalysisPropertyFence(tx, scope)
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.organizationId} || ':' || ${scope.propertyId}::text, 0))`,
      )
      const profile = await currentProfile(tx, scope)
      if (!profile) return false
      const head = await lockAggregateHead(tx, { ...scope, analysisSequence: 0 })
      const moved = await tx.execute(sql`
        WITH batch AS (
          SELECT contribution.organization_id, contribution.property_id,
            contribution.review_id, contribution.source_epoch,
            contribution.source_revision, contribution.analysis_sequence
          FROM ai_property_aggregate_contributions AS contribution
          INNER JOIN ai_property_processing_profiles AS profile
            ON profile.organization_id = contribution.organization_id
           AND profile.property_id = contribution.property_id
          WHERE ${pendingContribution(scope)}
          ORDER BY contribution.analysis_sequence
          LIMIT ${limit}
        )
        UPDATE ai_property_aggregate_contributions AS contribution
        SET property_profile_version = ${scope.propertyProfileVersion},
          local_date = ai_property_local_date_v1(review.reviewed_at, ${profile.timezone}),
          applied_aggregate_revision = ${head.aggregateRevision + 1},
          applied_at = transaction_timestamp()
        FROM batch, reviews AS review
        WHERE contribution.organization_id = batch.organization_id
          AND contribution.property_id = batch.property_id
          AND contribution.review_id = batch.review_id
          AND contribution.source_epoch = batch.source_epoch
          AND contribution.source_revision = batch.source_revision
          AND contribution.analysis_sequence = batch.analysis_sequence
          AND review.organization_id = batch.organization_id
          AND review.property_id = batch.property_id AND review.id = batch.review_id
        RETURNING contribution.review_id
      `)
      // Count settled exclusions and superseded sequences too, but never call
      // the profile caught up while an effective contribution is still pending.
      await tx
        .update(aiPropertyAggregateHeads)
        .set({
          aggregateRevision: head.aggregateRevision + (moved.rows.length > 0 ? 1 : 0),
          settledAnalysisCount: sql`(
          SELECT count(*) FROM ai_property_aggregate_settlements AS settlement
          WHERE settlement.organization_id = ${scope.organizationId}
            AND settlement.property_id = ${scope.propertyId}::uuid
            AND settlement.source_epoch = ${scope.sourceEpoch}
            AND settlement.review_analysis_epoch = ${scope.reviewAnalysisEpoch}
        ) - (
          SELECT count(*) FROM ai_property_aggregate_contributions AS contribution
          INNER JOIN ai_property_processing_profiles AS profile
            ON profile.organization_id = contribution.organization_id
           AND profile.property_id = contribution.property_id
          WHERE ${pendingContribution(scope)}
        )`,
          updatedAt: new Date(),
        })
        .where(headKey(scope))
      return true
    })
  }

  async function sweep(propertyLimit = 10, batchSize = 100): Promise<void> {
    if (!Number.isSafeInteger(propertyLimit) || propertyLimit < 1 || propertyLimit > 100)
      throw new Error('Invalid profile rebuild property limit')
    const startedAt = Date.now()
    const targets = await listPendingProfileRebuilds(db, propertyLimit)
    for (const target of targets.rows) {
      if (Date.now() - startedAt >= 15_000) break
      try {
        if (await rebuildProperty(target, batchSize)) continue
      } catch (error) {
        logger?.warn(
          {
            ...(error instanceof Error ? { err: error } : {}),
            organizationId: target.organizationId,
            propertyId: target.propertyId,
          },
          'AI profile rebuild failed',
        )
      }
      // Rotate held and failed Properties as well; one tenant cannot monopolize a tick.
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '1s'`)
          await tx.execute(sql`SET LOCAL statement_timeout = '1s'`)
          await tx
            .update(aiPropertyAggregateHeads)
            .set({ updatedAt: new Date() })
            .where(headKey(target))
        })
      } catch (error) {
        logger?.warn(
          {
            ...(error instanceof Error ? { err: error } : {}),
            organizationId: target.organizationId,
            propertyId: target.propertyId,
          },
          'AI profile rebuild retry scheduling failed',
        )
      }
    }
  }
  return { rebuildProperty, sweep }
}
