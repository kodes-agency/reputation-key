import { reviewSourceContents } from '#/shared/db/schema/review-source-content.schema'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyAggregateContributions,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  reviews,
} from '#/shared/db/schema'
import { AI_PROPERTY_CALENDAR_PROFILE_V1 } from '#/shared/ai-operation/ai-property-calendar-profile'
import type { AiPropertyAggregateStorePort } from './ai-property-aggregate-store.port.server'
import { lockReviewAnalysisPropertyFence } from './review-analysis-property-fence.server'
import { copyMentionsToContribution } from './ai-review-analysis-mentions.server'
import { assignContributionIssueGroups } from './ai-issue-group-assignment.server'
import {
  settleReviewSequence,
  settleWithoutContribution,
} from './ai-property-aggregate-settlement.server'
import {
  commitAggregateHead,
  lockAggregateHead,
} from './ai-property-aggregate-head.server'
import {
  withdrawReviewContribution,
  type Contribution,
} from './ai-property-aggregate-contributions.server'

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
            rating: sql<number>`${reviewSourceContents.rating}`,
            localDate: sql<string | null>`ai_property_local_date_v1(
              ${reviewSourceContents.reviewedAt}, ${analysis.timezone}
            )::text`,
          })
          .from(reviews)
          .innerJoin(
            reviewSourceContents,
            and(
              eq(reviewSourceContents.reviewId, reviews.id),
              eq(reviewSourceContents.organizationId, reviews.organizationId),
              eq(reviewSourceContents.propertyId, reviews.propertyId),
            ),
          )
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.propertyId, input.propertyId),
              eq(reviews.id, input.reviewId),
              eq(reviews.sourceEpoch, input.sourceEpoch),
              eq(reviews.sourceRevision, input.sourceRevision),
              eq(reviews.analysisSequence, input.analysisSequence),
              eq(reviews.sourceContentState, 'active'),
              isNotNull(reviewSourceContents.rating),
              isNotNull(reviewSourceContents.reviewedAt),
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
        const mentions = analysis.analysisProfileVersion === 'review-analysis-v3'
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
        await withdrawReviewContribution({ tx, command: input })
        await commitAggregateHead(tx, input, head, aggregateRevision, appliedAt)
        return { status: 'applied', aggregateRevision }
      })
    },
  }
}
