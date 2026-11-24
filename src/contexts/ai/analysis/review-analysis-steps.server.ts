// AI context — the two steps of a review analysis around the provider call.
//
// A review is read as twelve topics, each with a polarity, a strength, an optional
// cause and the sentences that state it, and an Urgent review is flagged with its
// one reason (annotation guide v3). `analyze-review-event.server.ts` owns the
// skeleton (authorize, read the source, claim, call the provider, store, settle);
// this file holds what happens either side of the call:
//
// - `prepareReviewAnalysis`, before the claim: the vocabulary hint set the request
//   carries, the provider and request profile it is sent under, and the normalizer
//   its answer passes through. The database refuses an operation without them. The
//   request carries the review's numbered sentences, the hints (never the
//   Property's name) and the provider the operation was claimed under, so the
//   gateway can end it when the operator has switched since.
// - `acceptReviewAnalysis`, after it: the answer is the gateway's normalized one,
//   repaired by the single acceptance point (contract 1.3), never the provider's
//   own. The attention is derived with `review-attention-v2` and stored beside the
//   mentions; a refused or truncated answer never gets this far.

import {
  REVIEW_ANALYSIS_V3_VERSIONS,
  deriveReviewAttentionV2,
} from '#/shared/analysis/review-analysis-v3'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from '#/shared/analysis/normalizer'
import { REVIEW_ANALYSIS_V3_LOGICAL_PROFILE } from '#/shared/analysis/profile'
import { reviewAnalysisV3GatewayResultSchema } from '#/shared/analysis/review-analysis-v3-request'
import { resolveReviewPropertyContext } from '#/shared/analysis/review-vocabulary-hints'
import { DERIVATIVE_RETENTION_MILLIS } from '../domain/types'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { AiReviewSourcePort } from '#/contexts/reputation/public-api'
import type { AiOperationId } from '../domain/types'
import type { AiOperationProviderLineage } from '../execution/ai-operation-store.port.server'
import type { AiOutputStorePort } from './ai-output-store.port.server'
import type { AiProviderChoicePort } from './ai-provider-choice.port.server'
import type { PropertyVocabularyContextPort } from './property-vocabulary-context.port.server'

/** The review as the source read hands it over: text, rating, sentences. */
export type ReviewAnalysisObservation = Extract<
  Awaited<ReturnType<AiReviewSourcePort['readForAi']>>,
  { status: 'available' }
>['observation']

/** What the binding, the authorization gate and the request deadline read of the profile. */
export const REVIEW_ANALYSIS_OPERATION_PROFILE = Object.freeze({
  profileVersion: REVIEW_ANALYSIS_V3_VERSIONS.analysisOperation,
  capabilityRuntimeProfileVersion: REVIEW_ANALYSIS_V3_VERSIONS.capabilityRuntime,
  requestDeadlineMs: REVIEW_ANALYSIS_V3_LOGICAL_PROFILE.limits.requestDeadlineMs,
})

export type ReviewAnalysisPreparation = Readonly<
  | {
      status: 'ready'
      /** Added to the operation claim. */
      claim: Readonly<{
        vocabularyHints: ReturnType<typeof resolveReviewPropertyContext>['hintIdentity']
        providerLineage: AiOperationProviderLineage
        normalization: Readonly<{ version: string; digest: string }>
      }>
      /** Added to the provider request beside the review itself. */
      request: Readonly<{
        sentences: NonNullable<ReviewAnalysisObservation['sentences']>
        propertyContext: ReturnType<
          typeof resolveReviewPropertyContext
        >['propertyContext']
        provider: Readonly<{
          id: AiOperationProviderLineage['providerId']
          model: string
          requestProfileVersion: string
          requestProfileDigest: string
        }>
      }>
    }
  /** A transient or configuration refusal: the review waits until it is restored. */
  | { status: 'refused'; code: string }
>

/**
 * `invalid`: the answer does not satisfy the contract, and the call has been
 * charged. `stale`: the review or its authorization moved while the provider
 * was answering, so nothing was stored. `stored`: the analysis is committed.
 */
export type ReviewAnalysisAcceptance = 'invalid' | 'stale' | 'stored'

export type ReviewAnalysisAcceptanceInput = Readonly<{
  operationId: AiOperationId
  expectedAttempt: number
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  authorizationLineageId: string
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  observation: ReviewAnalysisObservation
  /** The gateway's answer, not yet validated by anyone. */
  result: unknown
  completedAtEpochMillis: number
  inputTokens: number
  outputTokens: number
  providerLineage: AiOperationProviderLineage
}>

/** What is prepared once the source is known and before the operation is claimed. */
export async function prepareReviewAnalysis(
  dependencies: Readonly<{
    vocabularyContext: PropertyVocabularyContextPort
    providerChoice: AiProviderChoicePort
  }>,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    observation: ReviewAnalysisObservation
  }>,
): Promise<ReviewAnalysisPreparation> {
  const sentences = input.observation.sentences
  if (sentences === undefined) return { status: 'refused', code: 'sentences_unavailable' }
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
  return {
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
}

/** Validates the gateway's answer and stores it with its derived attention. */
export async function acceptReviewAnalysis(
  dependencies: Readonly<{ outputs: Pick<AiOutputStorePort, 'storeAnalysisV3'> }>,
  input: ReviewAnalysisAcceptanceInput,
): Promise<ReviewAnalysisAcceptance> {
  const lineage = input.providerLineage
  const parsed = reviewAnalysisV3GatewayResultSchema.safeParse(input.result)
  if (!parsed.success) return 'invalid'
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
}
