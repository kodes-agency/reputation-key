import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import {
  AI_OPERATION_PROFILES,
  AI_SOURCE_CANONICALIZER_PROFILE_V1,
} from '#/shared/ai-operation-profiles'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  mapReviewLanguageMetadata,
} from '#/shared/ai-review-language-catalogue'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { AnalysisResult } from '#/shared/ai-gateway-transport-contract'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type { AiInferencePort } from '../ports/ai-inference.port'
import type { AiOperationStorePort } from '../ports/ai-operation-store.port'
import type { AiOutputStorePort } from '../ports/ai-output-store.port'
import type { AiPropertyAggregateStorePort } from '../ports/ai-property-aggregate-store.port'
import type { AiQuotaPort } from '../ports/ai-quota.port'
import type {
  AiReviewEventDisposition,
  AiReviewEventStorePort,
} from '../ports/ai-review-event-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { AiSubjectHmacPort } from '../ports/ai-subject-hmac.port'
import type { AiExecutionBinding, AiOperationIdentity } from '../../domain/types'
import {
  aiRequestFingerprint,
  aiRetryAt,
  aiReviewSourceProvenance,
  resolveAiExecutionStopFence,
} from '../ai-workflow-support'

const PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === 'review-analysis-v1',
)!
const DERIVATIVE_RETENTION_MILLIS = 730 * 24 * 60 * 60 * 1_000

/**
 * BQC-3.6/3.7 budget alignment. `aiRetryAt` only terminal-settles at domain
 * attempt 4, and a domain attempt is consumed only once a provider attempt is
 * claimed: quota/rate backpressure, an in-progress lease, a drifted language
 * runtime and a not-yet-written Property processing profile all retry BEFORE
 * `claimExecution`, so they used to burn dispatch attempts without ever
 * reaching a terminal branch. The outcome row then stayed `pending` forever,
 * the terminal watermark froze there, and every later review was silently
 * excluded from the property aggregates.
 *
 * Every retry branch below is therefore additionally bounded in TIME by the
 * plan's 15-minute background operation horizon (§10.2): at or after the horizon
 * the operation terminal-settles with a code-only disposition instead of
 * retrying. Before a claim exists the horizon is anchored on the outbox row's
 * `recordedAt` (identical for every redelivery of one event); once an operation
 * exists it gets the later of that and its own `createdAt + horizon`, so a relay
 * backlog cannot cut short work that already started.
 *
 * With the outbox dispatch budget (8 attempts, exponential 30s backoff, 0.5
 * jitter) the minimum delay before attempt n+1 is 15s * 2^(n-1), so an attempt
 * at or past the horizon always exists for an operation first claimed on any of
 * attempts 1-7, and every pre-claim branch terminal-settles by attempt 7. No
 * `pending`-outcome sweeper is therefore required: termination is a property of
 * the horizon, not of the retry count.
 *
 * Two residuals are deliberate and unchanged by this fix: a `gap` result writes
 * no outcome row at all (so quarantining one cannot freeze the watermark — it
 * stalls the cursor exactly as before), and a terminal-settle whose own database
 * write fails on the last attempts leaves the row `pending`. The second is an
 * outage of the same store the sweeper would have to use.
 */
export const AI_ANALYSIS_OPERATION_HORIZON_MILLIS = 15 * 60 * 1_000
/** Advisory spacing recorded on a deferred (pre-provider-attempt) retry. */
const DEFERRED_RETRY_DELAY_MILLIS = 30_000

export type AnalyzeReviewEventInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  eventEnvelopeId: string
  disposition: AiReviewEventDisposition
  /**
   * BQC-3.7 envelope `recordedAt` as epoch milliseconds — the stable anchor for
   * the bounded operation horizon above. Null only for pre-3.7 in-flight
   * envelopes, where the claimed operation's `createdAt` anchors it instead.
   */
  eventRecordedAtEpochMillis: number | null
}>

export type AnalyzeReviewEventResult =
  | Readonly<{ status: 'completed' | 'replayed' | 'terminal' | 'generation_changed' }>
  | Readonly<{ status: 'retry'; retryAtEpochMillis: number; code: string }>
  | Readonly<{ status: 'gap'; expectedSequence: number }>

export type AnalyzeReviewEventDependencies = Readonly<{
  authorization: AiAuthorizationPort
  control: AiControlPort
  inference: AiInferencePort
  operations: AiOperationStorePort
  outputs: AiOutputStorePort
  aggregates: AiPropertyAggregateStorePort
  quota: AiQuotaPort
  reviewEvents: AiReviewEventStorePort
  reviewSources: AiReviewSourcePort
  processingProfiles: PropertyProcessingProfilePort
  subjectHmac: AiSubjectHmacPort
  nowEpochMillis: () => number
}>

function attentionFor(
  output: Extract<AnalysisResult, { status: 'success' }>['result'],
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

export function createAnalyzeReviewEvent(
  dependencies: AnalyzeReviewEventDependencies,
): (input: AnalyzeReviewEventInput) => Promise<AnalyzeReviewEventResult> {
  async function settleWithoutResult(
    input: AnalyzeReviewEventInput,
    reviewAnalysisEpoch: number,
    propertyProfileVersion: number,
    dispositionCode:
      | 'language_not_supported'
      | 'source_expired'
      | 'provider_deleted'
      | 'policy_disabled',
  ): Promise<AnalyzeReviewEventResult> {
    const settled = await dependencies.reviewEvents.settleOutcome({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      reviewAnalysisEpoch,
      analysisSequence: input.analysisSequence,
      state: 'terminal_no_result',
      operationId: null,
      dispositionCode,
    })
    if (!settled) return { status: 'generation_changed' }
    const aggregate = await dependencies.aggregates.advanceWithoutAnalysis({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      analysisSequence: input.analysisSequence,
      reviewAnalysisEpoch,
      propertyProfileVersion,
      dispositionCode,
    })
    if (aggregate.status === 'gap') {
      return { status: 'gap', expectedSequence: aggregate.expectedAnalysisSequence }
    }
    return aggregate.status === 'stale'
      ? { status: 'generation_changed' }
      : { status: 'terminal' }
  }

  /**
   * Retry while the operation horizon has not elapsed; terminal-settle once it
   * has. `policy_disabled` is the only generic terminal disposition the outcome
   * CHECK constraint admits, so the closed `code` travels in the retry result
   * and in telemetry rather than in a new column.
   */
  async function deferOrSettle(
    input: AnalyzeReviewEventInput,
    reviewAnalysisEpoch: number,
    propertyProfileVersion: number,
    code: string,
    nowEpochMillis: number,
    horizonEpochMillis: number | null,
  ): Promise<AnalyzeReviewEventResult> {
    if (horizonEpochMillis !== null && nowEpochMillis >= horizonEpochMillis) {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        propertyProfileVersion,
        'policy_disabled',
      )
    }
    return {
      status: 'retry',
      retryAtEpochMillis: nowEpochMillis + DEFERRED_RETRY_DELAY_MILLIS,
      code,
    }
  }

  return async (input) => {
    const nowEpochMillis = dependencies.nowEpochMillis()
    const eventHorizonEpochMillis =
      input.eventRecordedAtEpochMillis === null
        ? null
        : input.eventRecordedAtEpochMillis + AI_ANALYSIS_OPERATION_HORIZON_MILLIS
    const authorization =
      await dependencies.authorization.readMerchantAuthorization(input)
    const reviewAnalysisEpoch = authorization?.capabilityEpochs.review_analysis.epoch ?? 1
    const consumed = await dependencies.reviewEvents.consumeNext({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      reviewAnalysisEpoch,
      analysisStartSequence: authorization?.reviewAnalysisStartSequence ?? 0,
      analysisSequence: input.analysisSequence,
      eventEnvelopeId: input.eventEnvelopeId,
      disposition: input.disposition,
    })
    if (consumed.status === 'gap') {
      return { status: 'gap', expectedSequence: consumed.expectedSequence }
    }
    if (consumed.status === 'generation_changed') return { status: 'generation_changed' }

    const runtime = await dependencies.processingProfiles.readForAi({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
    })
    const profileVersionForSettle =
      runtime.status === 'available' ? runtime.profile.profileVersion : 1
    // A lifecycle transition needs no authorization, profile or provider call.
    // It must always terminal-settle so the terminal watermark advances.
    if (input.disposition !== 'pending') {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profileVersionForSettle,
        input.disposition,
      )
    }
    if (
      authorization === null ||
      authorization.state !== 'enabled' ||
      authorization.authorizationLineageId === null ||
      authorization.authorizedSourceEpoch !== input.sourceEpoch ||
      !authorization.capabilities.includes('review_analysis') ||
      authorization.capabilityRuntimeProfileVersions.review_analysis !==
        PROFILE.capabilityRuntimeProfileVersion
    ) {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profileVersionForSettle,
        'policy_disabled',
      )
    }
    if (runtime.status !== 'available') {
      // `not_found` is a profile row that has not been written yet and
      // `policy_unavailable` is a transient read failure. Neither is a merchant
      // decision, so neither may permanently terminal-skip this review.
      return runtime.status === 'not_found' || runtime.status === 'policy_unavailable'
        ? deferOrSettle(
            input,
            reviewAnalysisEpoch,
            profileVersionForSettle,
            `property_profile_${runtime.status}`,
            nowEpochMillis,
            eventHorizonEpochMillis,
          )
        : settleWithoutResult(
            input,
            reviewAnalysisEpoch,
            profileVersionForSettle,
            'policy_disabled',
          )
    }
    const profile = runtime.profile

    const source = await dependencies.reviewSources.readForAi({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: input.reviewId,
      expected: {
        kind: 'analysis',
        sourceEpoch: input.sourceEpoch,
        sourceRevision: input.sourceRevision,
        analysisSequence: input.analysisSequence,
      },
    })
    if (source.status !== 'available' || source.observation.text === null) {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        source.status === 'expired' ? 'source_expired' : 'policy_disabled',
      )
    }
    const observation = source.observation
    const language = mapReviewLanguageMetadata(observation.languageCode)
    if (language.status === 'policy_unavailable') {
      // Node/ICU drift. The pinned triple is asserted at image build time, but a
      // deliberate base-image digest bump can still move it: degrade, never
      // destroy — a terminal skip here would drop the review from the aggregates
      // permanently and could never be repaired by redeploying the right image.
      return deferOrSettle(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        'language_runtime_unavailable',
        nowEpochMillis,
        eventHorizonEpochMillis,
      )
    }
    if (language.status !== 'supported') {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        'language_not_supported',
      )
    }
    const canonicalSource = encodeCanonicalAiReviewSource({
      text: observation.text,
      rating: observation.rating,
      languageCode: observation.languageCode,
      reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
    })
    const provenance = aiReviewSourceProvenance(canonicalSource.bytes)
    canonicalSource.bytes.fill(0)
    const stopFence = await resolveAiExecutionStopFence(dependencies.control, {
      providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
      capability: 'review_analysis',
    })
    if (stopFence === null) {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        'policy_disabled',
      )
    }
    const subject = dependencies.subjectHmac.sign(input.reviewId)
    const identity: AiOperationIdentity = {
      subjectKind: 'property',
      command: 'analysis',
      capability: 'review_analysis',
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      actorId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId: input.reviewId,
      originEventId: input.eventEnvelopeId,
      subjectHmac: subject.digest,
      subjectHmacKeyVersion: subject.keyVersion,
      sourceEpoch: input.sourceEpoch,
      sourceRevision: input.sourceRevision,
      reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
      analysisSequence: input.analysisSequence,
    }
    const binding: AiExecutionBinding = {
      authorizationLineageId: authorization.authorizationLineageId,
      noticeVersion: authorization.noticeVersion,
      noticeDigest: authorization.noticeDigest,
      capabilityFence: {
        capability: 'review_analysis',
        reviewAnalysisEpoch,
      },
      sourceEpoch: input.sourceEpoch,
      evaluatedLanguage: language.language.group,
      concreteReplyLanguage: null,
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: input.sourceRevision,
      reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
      propertyProfileVersion: profile.profileVersion,
      routingPolicyVersion: profile.routingPolicyVersion,
      sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
      sourceCanonicalizerDigest:
        AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
      redactionProfileVersion: authorization.redactionProfileFamily,
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
      operationProfileVersion: PROFILE.profileVersion,
      capabilityRuntimeProfileVersion: PROFILE.capabilityRuntimeProfileVersion!,
      aiSubjectHmacKeyVersion: subject.keyVersion,
      stopFence,
    }
    const requestFingerprint = aiRequestFingerprint({ identity, binding, provenance })
    const claimed = await dependencies.operations.claim({
      identity,
      binding,
      idempotencyKey: `analysis:${input.eventEnvelopeId}`,
      requestFingerprint,
      sourceProvenance: provenance,
      nowEpochMillis,
      expiresAtEpochMillis: nowEpochMillis + 24 * 60 * 60 * 1_000,
    })
    if (claimed.status === 'conflict') {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        'policy_disabled',
      )
    }
    if (
      claimed.operation.state === 'succeeded' ||
      claimed.operation.state === 'succeeded_pending_delivery'
    ) {
      const settled = await dependencies.reviewEvents.settleOutcome({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        sourceEpoch: input.sourceEpoch,
        reviewAnalysisEpoch,
        analysisSequence: input.analysisSequence,
        state: 'ready',
        operationId: claimed.operation.id,
        dispositionCode: null,
      })
      if (!settled) return { status: 'generation_changed' }
      const aggregate = await dependencies.aggregates.applyReviewAnalysis({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        sourceEpoch: input.sourceEpoch,
        sourceRevision: input.sourceRevision,
        analysisSequence: input.analysisSequence,
        reviewAnalysisEpoch,
        propertyProfileVersion: profile.profileVersion,
        calendarProfileVersion: 'property-calendar-v1',
      })
      if (aggregate.status === 'gap') {
        return { status: 'gap', expectedSequence: aggregate.expectedAnalysisSequence }
      }
      if (aggregate.status === 'stale' || aggregate.status === 'unavailable') {
        return { status: 'generation_changed' }
      }
      await dependencies.operations.markDelivered({
        operationId: claimed.operation.id,
        expectedAttempt: claimed.operation.executionAttempt,
        deliveredAtEpochMillis: nowEpochMillis,
      })
      return { status: 'replayed' }
    }
    // Once an operation exists it gets the plan's full 15 minutes from its own
    // `createdAt`, so a relay backlog cannot cut short work that has already
    // started. The provider-attempt cap (4, below) terminates this path
    // independently; only the quota/lease deferrals rely on this horizon.
    const operationHorizonEpochMillis = Math.max(
      eventHorizonEpochMillis ?? 0,
      claimed.operation.createdAtEpochMillis + AI_ANALYSIS_OPERATION_HORIZON_MILLIS,
    )
    const expectedAttempt = claimed.operation.executionAttempt + 1
    if (expectedAttempt > 4) {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        'policy_disabled',
      )
    }
    const quota = await dependencies.quota.acquire({
      propertyId: input.propertyId,
      capability: 'review_analysis',
      nowEpochMillis,
    })
    if (!quota.ok) {
      return deferOrSettle(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        quota.code,
        nowEpochMillis,
        operationHorizonEpochMillis,
      )
    }
    try {
      const execution = await dependencies.operations.claimExecution({
        operationId: claimed.operation.id,
        expectedAttempt,
        nowEpochMillis,
      })
      if (execution === null || execution.executionPermitId === null) {
        return deferOrSettle(
          input,
          reviewAnalysisEpoch,
          profile.profileVersion,
          'operation_in_progress',
          nowEpochMillis,
          operationHorizonEpochMillis,
        )
      }
      const response = await dependencies.inference.analyzeReview(
        {
          route: 'review-analysis',
          operationId: execution.id,
          permitId: execution.executionPermitId,
          attemptNumber: expectedAttempt,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          internalSubjectId: input.reviewId,
          actorId: null,
          binding,
          deadlineEpochMillis: nowEpochMillis + PROFILE.requestDeadlineMs,
          redactionCountry: profile.countryCode,
          observedContentExpiresAtEpochMillis: observation.contentExpiresAtEpochMillis,
          source: {
            kind: 'review',
            text: observation.text,
            rating: observation.rating,
            languageCode: observation.languageCode,
            reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
          },
        },
        AbortSignal.timeout(PROFILE.requestDeadlineMs),
      )
      if (response.status === 'error') {
        const retryAtEpochMillis = aiRetryAt(
          expectedAttempt,
          nowEpochMillis,
          response.retryAfterEpochMillis,
        )
        await dependencies.operations.recordFailure({
          operationId: execution.id,
          expectedAttempt,
          failureCode: response.code,
          retryAtEpochMillis,
          failedAtEpochMillis: dependencies.nowEpochMillis(),
        })
        if (retryAtEpochMillis !== null) {
          return { status: 'retry', retryAtEpochMillis, code: response.code }
        }
        return settleWithoutResult(
          input,
          reviewAnalysisEpoch,
          profile.profileVersion,
          'policy_disabled',
        )
      }
      const completedAtEpochMillis = response.settlementReceipt.settledAtEpochMillis
      const stored = await dependencies.outputs.storeAnalysis({
        operationId: execution.id,
        providerCompletion: {
          expectedAttempt,
          modelSnapshot: AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot,
          inputTokens: response.settlementReceipt.inputTokens,
          outputTokens: response.settlementReceipt.outputTokens,
          completedAtEpochMillis,
        },
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        sourceEpoch: input.sourceEpoch,
        sourceRevision: input.sourceRevision,
        analysisSequence: input.analysisSequence,
        authorizationLineageId: authorization.authorizationLineageId,
        reviewAnalysisEpoch,
        propertyProfileVersion: profile.profileVersion,
        analysisProfileVersion: PROFILE.profileVersion,
        result: {
          status: 'ready',
          derivative: {
            sentiment: response.result.sentiment,
            primaryCategory: response.result.primaryCategory,
            attention: attentionFor(response.result, observation.rating),
          },
        },
        generatedAtEpochMillis: completedAtEpochMillis,
        expiresAtEpochMillis: completedAtEpochMillis + DERIVATIVE_RETENTION_MILLIS,
      })
      if (!stored) return { status: 'generation_changed' }
      const settled = await dependencies.reviewEvents.settleOutcome({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        sourceEpoch: input.sourceEpoch,
        reviewAnalysisEpoch,
        analysisSequence: input.analysisSequence,
        state: 'ready',
        operationId: execution.id,
        dispositionCode: null,
      })
      if (!settled) return { status: 'generation_changed' }
      const aggregate = await dependencies.aggregates.applyReviewAnalysis({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        sourceEpoch: input.sourceEpoch,
        sourceRevision: input.sourceRevision,
        analysisSequence: input.analysisSequence,
        reviewAnalysisEpoch,
        propertyProfileVersion: profile.profileVersion,
        calendarProfileVersion: 'property-calendar-v1',
      })
      if (aggregate.status === 'gap') {
        return { status: 'gap', expectedSequence: aggregate.expectedAnalysisSequence }
      }
      if (aggregate.status === 'stale' || aggregate.status === 'unavailable') {
        return { status: 'generation_changed' }
      }
      await dependencies.operations.markDelivered({
        operationId: execution.id,
        expectedAttempt,
        deliveredAtEpochMillis: dependencies.nowEpochMillis(),
      })
      return { status: 'completed' }
    } finally {
      await dependencies.quota.release({ quotaId: quota.quotaId })
    }
  }
}
