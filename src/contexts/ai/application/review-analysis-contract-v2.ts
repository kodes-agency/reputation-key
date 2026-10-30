// AI context — the review-analysis v2 contract, the one every build runs today.
//
// Everything here ran inline in `analyze-review-event.ts` before the contract
// seam existed and moved here without changing: the profile facts, the answer's
// schema, the issue-label refusal, the attention formula and the call that stores
// the analysis. Nothing is prepared before the claim and the request carries the
// review alone, which is why a v2 operation's claim and provider request are
// byte-for-byte what they were.

import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import {
  AI_ANALYSIS_V2_OUTPUT_SCHEMA,
  type AiAnalysisV2Output,
} from '#/shared/ai-route-output-schemas'
import type { AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import { issueLabelReproducesSource } from '#/shared/ai-issue-label'
import { DERIVATIVE_RETENTION_MILLIS } from '../domain/types'
import type { AiOutputStorePort } from './ports/ai-output-store.port'
import type { ReviewAnalysisContract } from './review-analysis-contract'
import { isAiAuthorizationUnderServedContract } from './ai-workflow-support'

const PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === 'review-analysis-v2',
)!

/** Content-free record of a governed refusal. Carries identifiers and the rule
 *  only: the refused label and the matched excerpt are deliberately absent. */
export type AiAnalysisObservabilityPort = Readonly<{
  recordIssueLabelRefused(
    event: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      analysisSequence: number
      rule: 'reproduces_source'
    }>,
  ): void
}>

export function derivePrimaryCategoryV1(
  aspects: ReadonlyArray<
    Readonly<{
      aspect: AspectTaxonomyV1Id
      polarity: 'positive' | 'neutral' | 'negative'
      intensity: number
    }>
  >,
): AspectTaxonomyV1Id {
  let primary:
    | Readonly<{
        aspect: AspectTaxonomyV1Id
        polarity: 'positive' | 'neutral' | 'negative'
        intensity: number
      }>
    | undefined
  for (const candidate of aspects) {
    if (
      primary === undefined ||
      Math.abs(candidate.intensity) > Math.abs(primary.intensity) ||
      (Math.abs(candidate.intensity) === Math.abs(primary.intensity) &&
        candidate.polarity === 'negative' &&
        primary.polarity !== 'negative')
    ) {
      primary = candidate
    }
  }
  return primary?.aspect ?? 'other'
}

function attentionFor(
  output: AiAnalysisV2Output,
  rating: number,
): 'urgent' | 'high' | 'medium' | 'low' {
  if (
    output.urgencySignals.some((signal) =>
      ['safety', 'health', 'discrimination', 'legal', 'fraud'].includes(signal),
    )
  ) {
    return 'urgent'
  }
  if (
    output.urgencySignals.includes('service_failure') ||
    output.sentimentValence <= -60 ||
    (rating <= 2 && output.sentiment !== 'positive')
  ) {
    return 'high'
  }
  if (
    output.sentiment === 'negative' ||
    output.sentiment === 'mixed' ||
    output.sentimentValence <= -20 ||
    rating <= 3
  ) {
    return 'medium'
  }
  return 'low'
}

export function createReviewAnalysisContractV2(
  dependencies: Readonly<{
    outputs: Pick<AiOutputStorePort, 'storeAnalysis'>
    observability?: AiAnalysisObservabilityPort
  }>,
): ReviewAnalysisContract {
  const contract: ReviewAnalysisContract = {
    contract: 'v2',
    operationProfile: Object.freeze({
      profileVersion: PROFILE.profileVersion,
      capabilityRuntimeProfileVersion: PROFILE.capabilityRuntimeProfileVersion!,
      requestDeadlineMs: PROFILE.requestDeadlineMs,
    }),
    isServedContract: (authorization) =>
      isAiAuthorizationUnderServedContract(authorization, 'review_analysis'),
    sourceRead: Object.freeze({}),
    prepare: async () => ({ status: 'ready' as const, claim: {}, request: {} }),
    accept: async (input) => {
      const parsedAnalysis = AI_ANALYSIS_V2_OUTPUT_SCHEMA.safeParse(input.result)
      if (!parsedAnalysis.success) return 'invalid'
      const analysisResult = parsedAnalysis.data
      const observation = input.observation
      // The merchant notice promises the issue label never reproduces review
      // text. The output schema, the server-side shape check and the SQL
      // CHECK all validate shape only, so a lowercase quotation satisfies
      // every layer. Refuse a multi-word label whose words follow one another
      // in the source; the aspects are the expensive part of the call and stay.
      // Refused content is never logged — recording the label would leak the
      // very excerpt the rule exists to keep out of storage.
      const reproducesSource =
        analysisResult.issueLabel !== null &&
        observation.text !== null &&
        issueLabelReproducesSource(analysisResult.issueLabel, observation.text)
      const acceptedIssueLabel = reproducesSource ? null : analysisResult.issueLabel
      if (reproducesSource) {
        dependencies.observability?.recordIssueLabelRefused({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          reviewId: input.reviewId,
          analysisSequence: input.analysisSequence,
          rule: 'reproduces_source',
        })
      }
      const stored = await dependencies.outputs.storeAnalysis({
        operationId: input.operationId,
        providerCompletion: {
          expectedAttempt: input.expectedAttempt,
          modelSnapshot: AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot,
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
        analysisProfileVersion: PROFILE.profileVersion,
        result: {
          status: 'ready',
          derivative: {
            sentiment: analysisResult.sentiment,
            primaryCategory: derivePrimaryCategoryV1(analysisResult.aspects),
            attention: attentionFor(analysisResult, observation.rating),
            aspects: analysisResult.aspects,
            issueLabel: acceptedIssueLabel,
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
