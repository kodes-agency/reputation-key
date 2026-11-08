import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributions,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  aiReviewAnalysisAspects,
  reviews,
} from '#/shared/db/schema'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { OPENAI_MODEL_SNAPSHOT } from '#/shared/ai-openai-request-contract'
import { AI_PROPERTY_CALENDAR_PROFILE_V1 } from '#/shared/ai-property-calendar-profile'
import type {
  AiPropertyAnalyzedReview,
  AiPropertyAggregateStorePort,
  AiPropertyUnavailableReview,
} from '../../application/ports/ai-property-aggregate-store.port'
import { lockReviewAnalysisPropertyFence } from './review-analysis-property-fence'
import { readLockedAggregateHead } from './ai-property-aggregate-coverage'
import { AI_INSIGHTS_READ_BUDGET_MS, withStatementTimeout } from './ai-read-timeout'
import {
  dailyCountsFromReviews,
  mapAnalyzedReview,
  mapUnavailableReview,
} from './ai-property-aggregate-window-mappers'
import { copyMentionsToContribution } from './ai-review-analysis-mentions'
import { assignContributionIssueGroups } from './ai-issue-group-assignment'
import {
  settleReviewSequence,
  settleWithoutContribution,
} from './ai-property-aggregate-settlement'

// Re-exported: the legacy evidence boundary is tested through this module.
export { mapAnalyzedReview }
import { commitAggregateHead, lockAggregateHead } from './ai-property-aggregate-head'
import {
  withdrawReviewContribution,
  type Contribution,
} from './ai-property-aggregate-contributions'

export const createAiPropertyAggregateStoreAdapter = (
  db: Database,
): AiPropertyAggregateStorePort => {
  return {
    async applyReviewAnalysis(input) {
      return db.transaction(async (tx) => {
        await lockReviewAnalysisPropertyFence(tx, input)
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${input.organizationId} || ':' || ${input.propertyId}::text, 0)
          )
        `)
        const [replayed] = await tx
          .select()
          .from(aiPropertyAggregateContributions)
          .where(
            and(
              eq(aiPropertyAggregateContributions.organizationId, input.organizationId),
              eq(aiPropertyAggregateContributions.propertyId, input.propertyId),
              eq(aiPropertyAggregateContributions.reviewId, input.reviewId),
              eq(aiPropertyAggregateContributions.sourceEpoch, input.sourceEpoch),
              eq(aiPropertyAggregateContributions.sourceRevision, input.sourceRevision),
              eq(
                aiPropertyAggregateContributions.analysisSequence,
                input.analysisSequence,
              ),
            ),
          )
          .limit(1)
        if (replayed) {
          return {
            status: 'replayed',
            aggregateRevision: replayed.appliedAggregateRevision,
          }
        }
        const appliedAt = new Date()
        const settlement = await settleReviewSequence(tx, input, appliedAt)
        if (settlement === 'stale') return { status: 'stale' }

        const [analysis] = await tx
          .select({
            reviewAnalysisEpoch: aiReviewAnalyses.reviewAnalysisEpoch,
            propertyProfileVersion: aiReviewAnalyses.propertyProfileVersion,
            status: aiReviewAnalyses.status,
            analysisProfileVersion: aiReviewAnalyses.analysisProfileVersion,
            sentiment: aiReviewAnalyses.sentiment,
            primaryCategory: aiReviewAnalyses.primaryCategory,
            attention: aiReviewAnalyses.attention,
            expiresAt: aiReviewAnalyses.expiresAt,
            timezone: aiPropertyProcessingProfiles.timezone,
          })
          .from(aiReviewAnalyses)
          .innerJoin(
            aiPropertyProcessingProfiles,
            and(
              eq(
                aiPropertyProcessingProfiles.organizationId,
                aiReviewAnalyses.organizationId,
              ),
              eq(aiPropertyProcessingProfiles.propertyId, aiReviewAnalyses.propertyId),
              eq(aiPropertyProcessingProfiles.sourceEpoch, input.sourceEpoch),
              eq(
                aiPropertyProcessingProfiles.profileVersion,
                input.propertyProfileVersion,
              ),
              eq(aiPropertyProcessingProfiles.lifecycleState, 'active'),
            ),
          )
          .where(
            and(
              eq(aiReviewAnalyses.organizationId, input.organizationId),
              eq(aiReviewAnalyses.propertyId, input.propertyId),
              eq(aiReviewAnalyses.reviewId, input.reviewId),
              eq(aiReviewAnalyses.sourceEpoch, input.sourceEpoch),
              eq(aiReviewAnalyses.sourceRevision, input.sourceRevision),
              eq(aiReviewAnalyses.analysisSequence, input.analysisSequence),
            ),
          )
          .limit(1)
          .for('share')
        if (!analysis) {
          return settleWithoutContribution(tx, input, settlement, appliedAt, 'stale')
        }
        if (
          ![
            analysis.reviewAnalysisEpoch === input.reviewAnalysisEpoch,
            analysis.propertyProfileVersion === input.propertyProfileVersion,
          ].every(Boolean)
        ) {
          return settleWithoutContribution(tx, input, settlement, appliedAt, 'stale')
        }
        const [currentReview] = await tx
          .select({
            rating: sql<number>`${reviews.rating}`,
            localDate: sql<string | null>`ai_property_local_date_v1(
              ${reviews.reviewedAt}, ${analysis.timezone}
            )::text`,
          })
          .from(reviews)
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.propertyId, input.propertyId),
              eq(reviews.id, input.reviewId),
              eq(reviews.sourceEpoch, input.sourceEpoch),
              eq(reviews.sourceRevision, input.sourceRevision),
              eq(reviews.analysisSequence, input.analysisSequence),
              eq(reviews.sourceContentState, 'active'),
              isNotNull(reviews.rating),
              isNotNull(reviews.reviewedAt),
            ),
          )
          .limit(1)
          .for('share')
        if (!currentReview) {
          return settleWithoutContribution(tx, input, settlement, appliedAt, 'stale')
        }
        if (currentReview.localDate === null) {
          return settleWithoutContribution(
            tx,
            input,
            settlement,
            appliedAt,
            'unavailable',
          )
        }
        const currentAnalysis: Contribution = {
          status: analysis.status,
          rating: currentReview.rating,
          sentiment: analysis.sentiment,
          primaryCategory: analysis.primaryCategory,
          attention: analysis.attention,
        }
        // A v3 analysis has mentions, not aspects (migration 0078).
        const mentions = analysis.analysisProfileVersion === 'review-analysis-v3'
        if (analysis.status === 'ready' && !mentions) {
          const aspects = await tx
            .select({ aspect: aiReviewAnalysisAspects.aspect })
            .from(aiReviewAnalysisAspects)
            .where(
              and(
                eq(aiReviewAnalysisAspects.organizationId, input.organizationId),
                eq(aiReviewAnalysisAspects.propertyId, input.propertyId),
                eq(aiReviewAnalysisAspects.reviewId, input.reviewId),
                eq(aiReviewAnalysisAspects.sourceEpoch, input.sourceEpoch),
                eq(aiReviewAnalysisAspects.sourceRevision, input.sourceRevision),
                eq(aiReviewAnalysisAspects.analysisSequence, input.analysisSequence),
              ),
            )
            .for('share')
          if (
            aspects.length > 5 ||
            (aspects.length === 0 &&
              analysis.analysisProfileVersion !== 'review-analysis-v1')
          ) {
            throw new Error('Property analysis aspect rows are invalid')
          }
        }
        const head = await lockAggregateHead(tx, input)
        if (settlement === 'replayed') {
          return { status: 'replayed', aggregateRevision: head.aggregateRevision }
        }

        const aggregateRevision = head.aggregateRevision + 1
        const [inserted] = await tx
          .insert(aiPropertyAggregateContributions)
          .values({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            reviewId: input.reviewId,
            sourceEpoch: input.sourceEpoch,
            sourceRevision: input.sourceRevision,
            analysisSequence: input.analysisSequence,
            reviewAnalysisEpoch: input.reviewAnalysisEpoch,
            propertyProfileVersion: input.propertyProfileVersion,
            calendarProfileVersion: AI_PROPERTY_CALENDAR_PROFILE_V1.profileVersion,
            localDate: currentReview.localDate,
            status: currentAnalysis.status,
            rating: currentAnalysis.rating,
            sentiment: currentAnalysis.sentiment,
            primaryCategory: currentAnalysis.primaryCategory,
            attention: currentAnalysis.attention,
            appliedAggregateRevision: aggregateRevision,
            appliedAt,
          })
          .onConflictDoNothing()
          .returning({
            analysisSequence: aiPropertyAggregateContributions.analysisSequence,
          })
        if (!inserted) throw new Error('Property aggregate contribution conflict')
        if (mentions && analysis.status === 'ready') {
          await copyMentionsToContribution(tx, input)
          await assignContributionIssueGroups(tx, input, analysis.expiresAt, appliedAt)
        }
        await commitAggregateHead(tx, input, head, aggregateRevision, appliedAt)
        return { status: 'applied', aggregateRevision }
      })
    },

    async advanceWithoutAnalysis(input) {
      return db.transaction(async (tx) => {
        await lockReviewAnalysisPropertyFence(tx, input)
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${input.organizationId} || ':' || ${input.propertyId}::text, 0)
          )
        `)
        const appliedAt = new Date()
        const settlement = await settleReviewSequence(tx, input, appliedAt)
        if (settlement === 'stale') return { status: 'stale' }

        const head = await lockAggregateHead(tx, input)
        if (settlement === 'replayed') {
          return { status: 'replayed', aggregateRevision: head.aggregateRevision }
        }

        const aggregateRevision = head.aggregateRevision + 1

        // The review's newest sequence has no analysis, so whatever an earlier
        // sequence put on a day is no longer true of it.
        await withdrawReviewContribution({
          tx,
          command: input,
          head,
          aggregateRevision,
          appliedAt,
        })
        await commitAggregateHead(tx, input, head, aggregateRevision, appliedAt)
        return { status: 'applied', aggregateRevision }
      })
    },

    async readWindow(input) {
      return withStatementTimeout(db, AI_INSIGHTS_READ_BUDGET_MS, async (tx) => {
        const locked = await readLockedAggregateHead(tx, input)
        if (locked === null) return null
        const { head, coverage: analysisCoverage } = locked
        const analyzed = await tx.execute<{
          reviewId: string
          sourceRevision: number | string
          analysisSequence: number | string
          localDate: string
          rating: number
          status: string
          unavailableReason: string | null
          sentiment: string | null
          attention: string | null
          aspects: unknown
          issueLabel: string | null
          analysisProfileVersion: string
          providerDeploymentProfileVersion: string
          modelSnapshot: string
        }>(sql`
          WITH latest AS (
            SELECT DISTINCT ON (contribution.review_id) contribution.*
            FROM ai_property_aggregate_contributions AS contribution
            WHERE contribution.organization_id = ${input.organizationId}
              AND contribution.property_id = ${input.propertyId}::uuid
              AND contribution.source_epoch = ${input.sourceEpoch}
              AND contribution.review_analysis_epoch = ${input.reviewAnalysisEpoch}
              AND contribution.property_profile_version = ${input.propertyProfileVersion}
            ORDER BY contribution.review_id, contribution.analysis_sequence DESC
          )
          SELECT
            latest.review_id::text AS "reviewId",
            latest.source_revision::float8 AS "sourceRevision",
            latest.analysis_sequence::float8 AS "analysisSequence",
            latest.local_date::text AS "localDate",
            latest.rating AS rating,
            analysis.status AS status,
            analysis.unavailable_reason AS "unavailableReason",
            latest.sentiment AS sentiment,
            latest.attention AS attention,
            analysis.issue_label AS "issueLabel",
            COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'aspect', contribution_aspect.aspect,
                  'polarity', contribution_aspect.polarity,
                  'intensity', contribution_aspect.intensity
                )
                ORDER BY contribution_aspect.aspect
              )
              FROM ai_review_analysis_aspects AS contribution_aspect
              WHERE contribution_aspect.organization_id = latest.organization_id
                AND contribution_aspect.property_id = latest.property_id
                AND contribution_aspect.review_id = latest.review_id
                AND contribution_aspect.source_epoch = latest.source_epoch
                AND contribution_aspect.source_revision = latest.source_revision
                AND contribution_aspect.analysis_sequence = latest.analysis_sequence
            ), '[]'::jsonb) AS aspects,
            analysis.analysis_profile_version AS "analysisProfileVersion",
            ${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}::text AS "providerDeploymentProfileVersion",
            ${OPENAI_MODEL_SNAPSHOT}::text AS "modelSnapshot"
          FROM latest
          INNER JOIN ai_review_analyses AS analysis
            ON analysis.organization_id = latest.organization_id
           AND analysis.property_id = latest.property_id
           AND analysis.review_id = latest.review_id
           AND analysis.source_epoch = latest.source_epoch
           AND analysis.source_revision = latest.source_revision
           AND analysis.analysis_sequence = latest.analysis_sequence
          INNER JOIN ai_operations AS operation ON operation.id = analysis.operation_id
          WHERE latest.status = analysis.status
            AND latest.status IN ('ready', 'unavailable')
            AND latest.local_date BETWEEN ${input.startLocalDate}::date AND ${input.endLocalDate}::date
            AND operation.state IN ('succeeded_pending_delivery', 'succeeded')
            AND analysis.analysis_profile_version <> 'review-analysis-v3'
          ORDER BY latest.local_date, latest.review_id
        `)
        const analyzedReviews: AiPropertyAnalyzedReview[] = []
        const unavailableReviews: AiPropertyUnavailableReview[] = []
        for (const row of analyzed.rows) {
          if (row.status === 'ready') {
            analyzedReviews.push(mapAnalyzedReview(row))
            continue
          }
          if (
            row.status === 'unavailable' &&
            Array.isArray(row.aspects) &&
            row.aspects.length === 0 &&
            row.sentiment === null &&
            row.attention === null &&
            row.issueLabel === null
          ) {
            unavailableReviews.push(mapUnavailableReview(row))
            continue
          }
          throw new Error('Property Review analysis outcome is invalid')
        }
        return {
          head: {
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            sourceEpoch: head.sourceEpoch,
            reviewAnalysisEpoch: head.reviewAnalysisEpoch,
            propertyProfileVersion: head.propertyProfileVersion,
            aggregateRevision: head.aggregateRevision,
            terminalAnalysisSequence: head.terminalAnalysisSequence,
          },
          coverage: analysisCoverage,
          days: dailyCountsFromReviews(analyzedReviews),
          analyzedReviews: Object.freeze(analyzedReviews),
          unavailableReviews: Object.freeze(unavailableReviews),
        }
      })
    },
  }
}
