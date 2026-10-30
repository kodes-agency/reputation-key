// Which review-analysis contract a build runs, and what each contract says about
// itself. The v3 contract is dark: the live catalogue selects v2, and the facts
// the v3 contract states are the ones the v3 profile and versions state.

import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  AI_OPERATION_PROFILES,
  type AiOperationProfile,
} from '#/shared/ai-operation-profiles'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  REVIEW_ANALYSIS_V3_VERSIONS,
  type ReviewAttentionLevelV2,
  type ReviewNamesPersonV3,
  type ReviewPolarityV3,
  type ReviewSentimentV3,
  type ReviewStrengthV3,
  type ReviewUrgentReasonV3,
} from '#/shared/review-analysis-v3'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type { ReviewAnalysisMentionV3, ReviewAnalysisReadV1 } from '../domain/types'
import { REVIEW_ANALYSIS_V3_LOGICAL_PROFILE } from '#/shared/review-analysis-v3-profile'
import { createReviewAnalysisContractV2 } from './review-analysis-contract-v2'
import { createReviewAnalysisContractV3 } from './review-analysis-contract-v3'
import { selectedReviewAnalysisContractVersion } from './review-analysis-runtime'

const SERVED_NOTICE = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
}

const v2 = createReviewAnalysisContractV2({
  outputs: { storeAnalysis: async () => true },
})
const v3 = createReviewAnalysisContractV3({
  outputs: { storeAnalysisV3: async () => true },
  vocabularyContext: { readGooglePrimaryCategory: async () => null },
  providerChoice: {
    chooseForReviewAnalysis: async () => ({
      status: 'unavailable',
      code: 'provider_selection_required',
    }),
  },
})

describe('the v3 vocabulary the domain spells for itself', () => {
  it('is the vocabulary of the shared v3 contract, member for member', () => {
    type ReadyV3 = Extract<ReviewAnalysisReadV1, { status: 'ready_v3' }>
    expectTypeOf<ReviewAnalysisMentionV3['topic']>().toEqualTypeOf<ReviewTopicV3>()
    expectTypeOf<ReviewAnalysisMentionV3['polarity']>().toEqualTypeOf<ReviewPolarityV3>()
    expectTypeOf<ReviewAnalysisMentionV3['strength']>().toEqualTypeOf<ReviewStrengthV3>()
    expectTypeOf<
      NonNullable<ReviewAnalysisMentionV3['namesPerson']>
    >().toEqualTypeOf<ReviewNamesPersonV3>()
    expectTypeOf<ReadyV3['sentiment']>().toEqualTypeOf<ReviewSentimentV3>()
    expectTypeOf<ReadyV3['attention']>().toEqualTypeOf<ReviewAttentionLevelV2>()
    expectTypeOf<
      NonNullable<ReadyV3['urgentReason']>
    >().toEqualTypeOf<ReviewUrgentReasonV3>()
  })
})

describe('the review analysis contract a build runs', () => {
  it('is v2 while the live runtime catalogue selects v2', () => {
    expect(selectedReviewAnalysisContractVersion()).toBe('v2')
  })

  it('states the v2 profile exactly as the catalogue holds it', () => {
    const profile = AI_OPERATION_PROFILES.find(
      (candidate: AiOperationProfile) =>
        candidate.profileVersion === 'review-analysis-v2',
    )

    expect(v2.contract).toBe('v2')
    expect(v2.operationProfile).toEqual({
      profileVersion: 'review-analysis-v2',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
      requestDeadlineMs: profile?.requestDeadlineMs,
    })
    expect(v2.sourceRead).toEqual({})
  })

  it('serves a consent recorded under the v2 deployment, and none recorded under v3', () => {
    expect(
      v2.isServedContract({
        ...SERVED_NOTICE,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      }),
    ).toBe(true)
    expect(
      v2.isServedContract({
        ...SERVED_NOTICE,
        providerDeploymentProfileVersion: 'private-beta-global-v2',
      }),
    ).toBe(false)
  })

  it('states the v3 profile as the v3 versions and the v3 logical profile state it', () => {
    expect(v3.contract).toBe('v3')
    expect(v3.operationProfile).toEqual({
      profileVersion: REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
      capabilityRuntimeProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.capabilityRuntime,
      requestDeadlineMs: REVIEW_ANALYSIS_V3_LOGICAL_PROFILE.limits.requestDeadlineMs,
    })
    expect(v3.sourceRead).toEqual({ sentences: true })
  })

  it('serves a consent recorded under the v3 deployment and the notice in force, and none under v1 or an unknown notice', () => {
    expect(
      v3.isServedContract({
        ...SERVED_NOTICE,
        providerDeploymentProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment,
      }),
    ).toBe(true)
    expect(
      v3.isServedContract({
        ...SERVED_NOTICE,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      }),
    ).toBe(false)
    expect(
      v3.isServedContract({
        noticeVersion: 'merchant-ai-notice-1999-01-01.v1',
        noticeDigest: 'f'.repeat(64),
        providerDeploymentProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment,
      }),
    ).toBe(false)
  })
})
