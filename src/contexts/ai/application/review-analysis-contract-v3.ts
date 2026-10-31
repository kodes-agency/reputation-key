// AI context — the review-analysis v3 contract, dark.
//
// A v3 analysis reads a review as twelve topics, each with a polarity, a
// strength, an optional cause and the sentences that state it, and flags an
// Urgent review with its one reason (annotation guide v3). What differs from v2 is
// concentrated here, and none of it is reachable until the live runtime
// catalogue selects this contract (`review-analysis-runtime.ts`):
//
// - Before the claim, the operation is given the lineage it must record: the
//   vocabulary hint set the request carries, the provider and request profile it
//   is sent under, and the normalizer its answer passes through. The database
//   refuses a v3 operation without them.
// - The request carries the review's numbered sentences, the hints (never the
//   Property's name) and the provider the operation was claimed under, so the
//   gateway can end it when the operator has switched since.
// - The answer is the gateway's normalized one: the provider's JSON, repaired by
//   the single acceptance point (contract 1.3), never the provider's own. The
//   attention is derived here with the v2 formula (`review-attention-v2`) and
//   stored beside the mentions; a refused or truncated answer never gets this far.

import { isAiAuthorizationUnderServedContract } from './ai-workflow-support'
import {
  REVIEW_ANALYSIS_V3_VERSIONS,
  deriveReviewAttentionV2,
} from '#/shared/review-analysis-v3'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from '#/shared/review-analysis-v3-normalizer'
import { REVIEW_ANALYSIS_V3_LOGICAL_PROFILE } from '#/shared/review-analysis-v3-profile'
import { reviewAnalysisV3GatewayResultSchema } from '#/shared/review-analysis-v3-request'
import { resolveReviewPropertyContext } from '#/shared/review-vocabulary-hints'
import { DERIVATIVE_RETENTION_MILLIS } from '../domain/types'
import type { AiOutputStorePort } from './ports/ai-output-store.port'
import type { AiProviderChoicePort } from './ports/ai-provider-choice.port'
import type { PropertyVocabularyContextPort } from './ports/property-vocabulary-context.port'
import type {
  ReviewAnalysisContract,
  ReviewAnalysisPreparation,
} from './review-analysis-contract'

export function createReviewAnalysisContractV3(
  dependencies: Readonly<{
    outputs: Pick<AiOutputStorePort, 'storeAnalysisV3'>
    vocabularyContext: PropertyVocabularyContextPort
    providerChoice: AiProviderChoicePort
  }>,
): ReviewAnalysisContract {
  const prepare: ReviewAnalysisContract['prepare'] = async (input) => {
    const sentences = input.observation.sentences
    if (sentences === undefined)
      return { status: 'refused', code: 'sentences_unavailable' }
    const category = await dependencies.vocabularyContext.readGooglePrimaryCategory({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
    })
    let resolved: ReturnType<typeof resolveReviewPropertyContext>
    try {
      resolved = resolveReviewPropertyContext(category)
    } catch {
      return { status: 'refused', code: 'property_context_invalid' }
    }
    const choice = await dependencies.providerChoice.chooseForReviewAnalysis()
    if (choice.status !== 'chosen') return { status: 'refused', code: choice.code }
    const lineage = choice.lineage
    const ready: ReviewAnalysisPreparation = {
      status: 'ready',
      claim: {
        vocabularyHints: resolved.hintIdentity,
        providerLineage: lineage,
        normalization: {
          version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
          digest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
        },
      },
      request: {
        sentences,
        propertyContext: resolved.propertyContext,
        provider: {
          id: lineage.providerId,
          model: lineage.model,
          requestProfileVersion: lineage.requestProfileVersion,
          requestProfileDigest: lineage.requestProfileDigest,
        },
      },
    }
    return ready
  }

  const contract: ReviewAnalysisContract = {
    contract: 'v3',
    operationProfile: Object.freeze({
      profileVersion: 'review-analysis-v3' as const,
      capabilityRuntimeProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.capabilityRuntime,
      requestDeadlineMs: REVIEW_ANALYSIS_V3_LOGICAL_PROFILE.limits.requestDeadlineMs,
    }),
    isServedContract: (authorization) =>
      isAiAuthorizationUnderServedContract(authorization, 'review_analysis'),
    sourceRead: Object.freeze({ sentences: true as const }),
    prepare,
    accept: async (input) => {
      const lineage = input.preparation.claim.providerLineage
      const parsed = reviewAnalysisV3GatewayResultSchema.safeParse(input.result)
      if (!parsed.success || lineage === undefined) return 'invalid'
      const { answer, normalization } = parsed.data
      const mentions = answer.mentions.map((mention) =>
        Object.freeze({
          topic: mention.topic,
          polarity: mention.polarity,
          strength: mention.strength,
          thing: mention.thing,
          issue: mention.issue,
          sentences: Object.freeze([...mention.sentences]),
          namesPerson: mention.names_person,
        }),
      )
      const stored = await dependencies.outputs.storeAnalysisV3({
        operationId: input.operationId,
        providerCompletion: {
          expectedAttempt: input.expectedAttempt,
          modelSnapshot: lineage.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          completedAtEpochMillis: input.completedAtEpochMillis,
        },
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        sourceEpoch: input.sourceEpoch,
        sourceRevision: input.sourceRevision,
        analysisSequence: input.analysisSequence,
        authorizationLineageId: input.authorizationLineageId,
        reviewAnalysisEpoch: input.reviewAnalysisEpoch,
        propertyProfileVersion: input.propertyProfileVersion,
        analysisProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
        derivative: {
          sentiment: answer.sentiment,
          attention: deriveReviewAttentionV2({
            rating: input.observation.rating,
            sentiment: answer.sentiment,
            urgent: answer.urgent,
            mentions,
          }),
          urgentReason: answer.urgent?.reason ?? null,
          mentions,
          normalization: {
            flags: normalization.flags,
            droppedMentionCount: normalization.droppedMentionCount,
          },
        },
        generatedAtEpochMillis: input.completedAtEpochMillis,
        expiresAtEpochMillis: input.completedAtEpochMillis + DERIVATIVE_RETENTION_MILLIS,
      })
      return stored ? 'stored' : 'stale'
    },
  }
  return Object.freeze(contract)
}
