import { reviewSourceContents } from '#/shared/db/schema/review-source-content.schema'
// Governed live-analysis identifiers for Inbox filters.

import {
  and,
  eq,
  exists,
  gt,
  inArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { ReviewId } from '#/shared/domain/ids'
import {
  aiPropertyAggregateContributions,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  merchantAiEnablement,
  reviews,
} from '#/shared/db/schema'

// Rebuilding changes projection ownership, never the profile recorded on paid
// operations. A read may follow that projection only for the exact source sequence.
export function analysisMatchesProcessingProfile(
  organizationId: string,
  profileVersion: number | SQLWrapper,
): SQL {
  return and(
    eq(aiReviewAnalyses.organizationId, organizationId),
    or(
      eq(aiReviewAnalyses.propertyProfileVersion, profileVersion),
      exists(sql`(
      SELECT 1 FROM ${aiPropertyAggregateContributions} AS projection
      WHERE projection.organization_id = ${organizationId}
        AND projection.organization_id = ${aiReviewAnalyses.organizationId}
        AND projection.property_id = ${aiReviewAnalyses.propertyId}
        AND projection.review_id = ${aiReviewAnalyses.reviewId}
        AND projection.source_epoch = ${aiReviewAnalyses.sourceEpoch}
        AND projection.source_revision = ${aiReviewAnalyses.sourceRevision}
        AND projection.analysis_sequence = ${aiReviewAnalyses.analysisSequence}
        AND projection.review_analysis_epoch = ${aiReviewAnalyses.reviewAnalysisEpoch}
        AND projection.status = ${aiReviewAnalyses.status}
        AND projection.property_profile_version = ${profileVersion}
    )`),
    ),
  )!
}

/**
 * The governed "which reviews currently have a live analysis" query, shared by
 * every attribute an inbox filter can select on.
 *
 * Everything except the discriminating predicate is policy, and it is the same
 * policy in every case: the merchant authorization must be enabled and still
 * carry `review_analysis`; the analysis must sit on the authorization's own
 * lineage and epoch; the analysis, the review and the processing profile must
 * all agree on the source epoch; the review content must not have expired; and
 * the profile must still be active. Copying that per attribute is how the two
 * lists in this codebase drifted, so callers supply only what distinguishes
 * them.
 */
export function findCurrentAnalysisReviewIds(
  db: Database,
  input: Readonly<{
    organizationId: string
    propertyIds?: readonly string[]
    reviewIds?: readonly string[]
    nowEpochMillis: number
  }>,
  discriminate: (now: Date) => readonly SQL<unknown>[],
): Promise<readonly ReviewId[]> {
  if (input.propertyIds?.length === 0) return Promise.resolve([])
  if (input.reviewIds?.length === 0) return Promise.resolve([])
  const now = new Date(input.nowEpochMillis)
  const conditions = [
    eq(aiReviewAnalyses.organizationId, input.organizationId),
    eq(aiReviewAnalyses.status, 'ready'),
    ...discriminate(now),
    eq(merchantAiEnablement.state, 'enabled'),
    sql`${merchantAiEnablement.capabilities} @> ARRAY['review_analysis']::text[]`,
    eq(
      aiReviewAnalyses.authorizationLineageId,
      merchantAiEnablement.authorizationLineageId,
    ),
    eq(aiReviewAnalyses.reviewAnalysisEpoch, merchantAiEnablement.reviewAnalysisEpoch),
    eq(aiReviewAnalyses.sourceEpoch, merchantAiEnablement.authorizedSourceEpoch),
    eq(aiReviewAnalyses.sourceEpoch, reviews.sourceEpoch),
    eq(aiReviewAnalyses.sourceRevision, reviews.sourceRevision),
    eq(aiReviewAnalyses.analysisSequence, reviews.analysisSequence),
    gt(reviewSourceContents.contentExpiresAt, now),
    eq(aiPropertyProcessingProfiles.lifecycleState, 'active'),
    analysisMatchesProcessingProfile(
      input.organizationId,
      aiPropertyProcessingProfiles.profileVersion,
    ),
    eq(aiReviewAnalyses.sourceEpoch, aiPropertyProcessingProfiles.sourceEpoch),
  ]
  if (input.propertyIds) {
    conditions.push(inArray(aiReviewAnalyses.propertyId, [...input.propertyIds]))
  }
  if (input.reviewIds) {
    conditions.push(inArray(aiReviewAnalyses.reviewId, [...input.reviewIds]))
  }
  return db
    .selectDistinct({ reviewId: aiReviewAnalyses.reviewId })
    .from(aiReviewAnalyses)
    .innerJoin(
      reviews,
      and(
        eq(reviews.organizationId, aiReviewAnalyses.organizationId),
        eq(reviews.propertyId, aiReviewAnalyses.propertyId),
        eq(reviews.id, aiReviewAnalyses.reviewId),
      ),
    )

    .innerJoin(
      reviewSourceContents,
      and(
        eq(reviewSourceContents.reviewId, reviews.id),
        eq(reviewSourceContents.organizationId, reviews.organizationId),
        eq(reviewSourceContents.propertyId, reviews.propertyId),
      ),
    )
    .innerJoin(
      merchantAiEnablement,
      and(
        eq(merchantAiEnablement.organizationId, aiReviewAnalyses.organizationId),
        eq(merchantAiEnablement.propertyId, aiReviewAnalyses.propertyId),
      ),
    )
    .innerJoin(
      aiPropertyProcessingProfiles,
      and(
        eq(aiPropertyProcessingProfiles.organizationId, aiReviewAnalyses.organizationId),
        eq(aiPropertyProcessingProfiles.propertyId, aiReviewAnalyses.propertyId),
      ),
    )
    .where(and(...conditions))
    .then((rows) => rows.map((row) => row.reviewId as ReviewId))
}
