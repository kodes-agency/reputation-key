// The review-analysis profile a build runs, and what it says about itself: the
// facts it states are the ones the v3 profile and versions state.

import { describe, expect, expectTypeOf, it } from 'vitest'
import { getAiRuntimeCapability } from '#/shared/merchant-ai-notice/ai-runtime-capability-contract'
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
} from '#/shared/analysis/review-analysis-v3'
import type { ReviewTopicV3 } from '#/shared/analysis/review-topic-taxonomy'
import type { ReviewAnalysisMentionV3, ReviewAnalysisReadV1 } from '../domain/types'
import { REVIEW_ANALYSIS_V3_LOGICAL_PROFILE } from '#/shared/analysis/profile'
import { isAiAuthorizationUnderServedContract } from '../application/ai-workflow-support'
import { REVIEW_ANALYSIS_OPERATION_PROFILE } from './review-analysis-steps.server'

const SERVED_NOTICE = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
}

const isServedContract = (
  authorization: Parameters<typeof isAiAuthorizationUnderServedContract>[0],
) => isAiAuthorizationUnderServedContract(authorization, 'review_analysis')

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

describe('the review analysis profile a build runs', () => {
  it('is v3, which the live runtime catalogue selects', () => {
    expect(getAiRuntimeCapability('review_analysis').operationProfileVersion).toBe(
      REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
    )
  })

  it('decides consent by the notice independently of recorded deployment evidence', () => {
    // Compatibility is decided against served execution. Historical deployment
    // evidence does not select the execution or require new consent.
    expect(
      isServedContract({
        ...SERVED_NOTICE,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      }),
    ).toBe(true)
  })

  it('states the v3 profile as the v3 versions and the v3 logical profile state it', () => {
    expect(REVIEW_ANALYSIS_OPERATION_PROFILE).toEqual({
      profileVersion: REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
      capabilityRuntimeProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.capabilityRuntime,
      requestDeadlineMs: REVIEW_ANALYSIS_V3_LOGICAL_PROFILE.limits.requestDeadlineMs,
    })
  })

  it('serves a consent recorded under the v3 deployment and the notice in force, including historical deployment evidence, and refuses an unknown notice', () => {
    expect(
      isServedContract({
        ...SERVED_NOTICE,
        providerDeploymentProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment,
      }),
    ).toBe(true)
    expect(
      isServedContract({
        ...SERVED_NOTICE,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      }),
    ).toBe(true)
    expect(
      isServedContract({
        noticeVersion: 'merchant-ai-notice-1999-01-01.v1',
        noticeDigest: 'f'.repeat(64),
        providerDeploymentProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.providerDeployment,
      }),
    ).toBe(false)
  })
})
