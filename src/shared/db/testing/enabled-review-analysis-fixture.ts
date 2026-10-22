// Test fixture: an enabled merchant AI authorization for one Property, written
// the way `apply_merchant_ai_transition_v1` writes it: an evidence row, then the
// head that points at it. Integration tests that need coverage to be measured
// (the stall monitor, the aggregate read, the trend scheduler) share it.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { merchantAiConsentEvidence, merchantAiEnablement } from '#/shared/db/schema'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'

const ACTOR = 'enabled-review-analysis-fixture'

export type EnabledReviewAnalysisFixture = Readonly<{
  organizationId: string
  propertyId: string
  authorizationLineageId: string
  analysisStartSequence: number
  authorizedSourceEpoch?: number
  /** Adds Property Trends beside Review Analysis. */
  propertyTrends?: boolean
  occurredAt?: Date
}>

export async function seedEnabledReviewAnalysis(
  db: Database,
  fixture: EnabledReviewAnalysisFixture,
): Promise<void> {
  const capabilities = fixture.propertyTrends
    ? ['review_analysis', 'property_trends']
    : ['review_analysis']
  const occurredAt = fixture.occurredAt ?? new Date()
  const row = {
    organizationId: fixture.organizationId,
    propertyId: fixture.propertyId,
    authorizationLineageId: fixture.authorizationLineageId,
    state: 'enabled' as const,
    capabilities,
    capabilityRuntimeProfileVersions: {
      review_analysis: 'review-analysis-runtime-v1',
      ...(fixture.propertyTrends
        ? { property_trends: 'property-trends-runtime-v1' }
        : {}),
    },
    reviewAnalysisEpoch: 1,
    replyDraftingEpoch: 1,
    propertyTrendsEpoch: 1,
    authorizedSourceEpoch: fixture.authorizedSourceEpoch ?? 0,
    analysisStartSequence: fixture.analysisStartSequence,
    stateVersion: 1,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    processingRegion: 'global' as const,
    providerDeploymentProfileVersion: 'private-beta-global-v1' as const,
    redactionProfileFamily: 'gbp-review-global-v1',
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      ...row,
      transitionKind: 'enable',
      actorUserId: ACTOR,
      reasonCode: 'merchant_enable',
      idempotencyKey: `${fixture.propertyId}-enable`,
      requestHash: 'd'.repeat(64),
      occurredAt,
    })
    await tx
      .insert(merchantAiEnablement)
      .values({ ...row, updatedBy: ACTOR, updatedAt: occurredAt })
  })
}
