// The review-analysis contract a build runs, and what it says about itself. The
// live catalogue selects v3 since the switch-on (2026-10-30); the facts the
// contract states are the ones the v3 profile and versions state.

import { describe, expect, expectTypeOf, it } from 'vitest'
import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
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
import { createReviewAnalysisContractV3 } from './review-analysis-contract-v3'

const SERVED_NOTICE = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
}

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
  it('is v3, which the live runtime catalogue selects', () => {
    expect(getAiRuntimeCapability('review_analysis').operationProfileVersion).toBe(
      REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
    )
  })

  it('decides consent by the notice independently of recorded deployment evidence', () => {
    // Compatibility is decided against served execution. Historical deployment
    // evidence does not select the execution or require new consent.
    expect(
      v3.isServedContract({
        ...SERVED_NOTICE,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      }),
    ).toBe(true)
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

  it('serves a consent recorded under the v3 deployment and the notice in force, including historical deployment evidence, and refuses an unknown notice', () => {
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
    ).toBe(true)
    expect(
      v3.isServedContract({
        noticeVersion: 'merchant-ai-notice-1999-01-01.v1',
        noticeDigest: 'f'.repeat(64),
        providerDeploymentProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment,
      }),
    ).toBe(false)
  })
})
