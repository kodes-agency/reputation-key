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
import { AI_ANALYSIS_V2_OUTPUT_SCHEMA } from '#/shared/openai-route-output-schemas'
import type { AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type { AiInferencePort } from '../ports/ai-inference.port'
import type { AiOperationStorePort } from '../ports/ai-operation-store.port'
import type { AiOutputStorePort } from '../ports/ai-output-store.port'
import { issueLabelReproducesSource } from '#/shared/ai-issue-label'
import type { AiPropertyAggregateStorePort } from '../ports/ai-property-aggregate-store.port'
import type { AiQuotaPort } from '../ports/ai-quota.port'
import type {
  AiReviewAnalysisTerminalDisposition,
  AiReviewEventDisposition,
  AiReviewEventStorePort,
} from '../ports/ai-review-event-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { AiSubjectHmacPort } from '../ports/ai-subject-hmac.port'
import {
  DERIVATIVE_RETENTION_MILLIS,
  type AiExecutionBinding,
  type AiOperationIdentity,
  type AiPropertyProfileResult,
} from '../../domain/types'
import {
  AI_PROVIDER_ATTEMPT_BUDGET,
  AI_PROVIDER_CAPACITY_CODES,
  aiRequestFingerprint,
  aiRetryAt,
  aiReviewSourceProvenance,
  resolveAiExecutionStopFence,
} from '../ai-workflow-support'

const PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === 'review-analysis-v2',
)!

/**
 * Every retry branch is bounded in time by the plan's 15-minute background
 * operation horizon (§10.2). Before an operation exists the outbox row's stable
 * `recordedAt` anchors the horizon; afterwards the operation gets the later of
 * that instant and `createdAt + horizon`.
 *
 * Reaching the horizon here still depends on another dispatch. BullMQ's finite
 * retry budget can exhaust first, so the recurring operation reaper is the
 * durable backstop for an analysis operation left `pending` after this request
 * owner disappears. It fences the operation before using the same idempotent
 * terminal settlement path below.
 */
export const AI_ANALYSIS_OPERATION_HORIZON_MILLIS = 15 * 60 * 1_000
/**
 * A backfill re-analyses a property's whole history in one burst, so the
 * provider's per-minute capacity, not the event's age, sets its pace. Its
 * operations get a day: a rate-limited tail is deferred, never abandoned.
 */
export const AI_BACKFILL_OPERATION_HORIZON_MILLIS = 24 * 60 * 60 * 1_000
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
  /** How long an operation for this event may stay open, by event kind. */
  operationHorizonMillis: number
}>

export type AnalyzeReviewEventResult =
  | Readonly<{ status: 'completed' | 'replayed' | 'terminal' | 'generation_changed' }>
  | Readonly<{ status: 'retry'; retryAtEpochMillis: number; code: string }>

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

export type AnalyzeReviewEventDependencies = Readonly<{
  observability?: AiAnalysisObservabilityPort
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

export type SettleReviewAnalysisWithoutResultInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  reviewAnalysisEpoch: number
  analysisSequence: number
  propertyProfileVersion: number
  operationId: string | null
  dispositionCode: AiReviewAnalysisTerminalDisposition
}>

export type SettleReviewAnalysisWithoutResultResult = Readonly<{
  status: 'terminal' | 'generation_changed'
}>

export async function settleReviewAnalysisWithoutResult(
  dependencies: Readonly<{
    reviewEvents: Pick<AiReviewEventStorePort, 'settleOutcome'>
    aggregates: Pick<AiPropertyAggregateStorePort, 'advanceWithoutAnalysis'>
  }>,
  input: SettleReviewAnalysisWithoutResultInput,
): Promise<SettleReviewAnalysisWithoutResultResult> {
  // A replayed terminal outcome does not prove the aggregate mutation committed.
  // Always run its idempotent settlement to close that crash window.
  await dependencies.reviewEvents.settleOutcome({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    analysisSequence: input.analysisSequence,
    state: 'terminal_no_result',
    operationId: input.operationId,
    dispositionCode: input.dispositionCode,
  })
  const aggregate = await dependencies.aggregates.advanceWithoutAnalysis({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    sourceEpoch: input.sourceEpoch,
    analysisSequence: input.analysisSequence,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    propertyProfileVersion: input.propertyProfileVersion,
    dispositionCode: input.dispositionCode,
  })
  return aggregate.status === 'stale'
    ? { status: 'generation_changed' }
    : { status: 'terminal' }
}

export type SettleReviewAnalysisWithResultInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  reviewAnalysisEpoch: number
  analysisSequence: number
  propertyProfileVersion: number
  operationId: string
}>

export type SettleReviewAnalysisWithResultResult = Readonly<{
  status: 'terminal' | 'generation_changed'
}>

export async function settleReviewAnalysisWithResult(
  dependencies: Readonly<{
    reviewEvents: Pick<AiReviewEventStorePort, 'settleOutcome'>
    aggregates: Pick<AiPropertyAggregateStorePort, 'applyReviewAnalysis'>
  }>,
  input: SettleReviewAnalysisWithResultInput,
): Promise<SettleReviewAnalysisWithResultResult> {
  // The outcome and aggregate have separate crash windows. Re-run the
  // idempotent aggregate mutation even when the outcome was already terminal.
  await dependencies.reviewEvents.settleOutcome({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: input.sourceEpoch,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    analysisSequence: input.analysisSequence,
    state: 'ready',
    operationId: input.operationId,
    dispositionCode: null,
  })
  const aggregate = await dependencies.aggregates.applyReviewAnalysis({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    sourceEpoch: input.sourceEpoch,
    sourceRevision: input.sourceRevision,
    analysisSequence: input.analysisSequence,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    propertyProfileVersion: input.propertyProfileVersion,
    calendarProfileVersion: 'property-calendar-v1',
  })
  return aggregate.status === 'stale' || aggregate.status === 'unavailable'
    ? { status: 'generation_changed' }
    : { status: 'terminal' }
}

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
  const settlementDependencies = {
    reviewEvents: dependencies.reviewEvents,
    aggregates: dependencies.aggregates,
  }

  function settleWithoutResult(
    input: AnalyzeReviewEventInput,
    reviewAnalysisEpoch: number,
    propertyProfileVersion: number,
    dispositionCode: AiReviewAnalysisTerminalDisposition,
  ): Promise<AnalyzeReviewEventResult> {
    return settleReviewAnalysisWithoutResult(settlementDependencies, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: input.reviewId,
      sourceEpoch: input.sourceEpoch,
      reviewAnalysisEpoch,
      analysisSequence: input.analysisSequence,
      propertyProfileVersion,
      operationId: null,
      dispositionCode,
    })
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

  /**
   * `not_found` is a profile row that has not been written yet and
   * `policy_unavailable` is a transient read failure. Neither is a merchant
   * decision, so neither may permanently terminal-skip this review.
   */
  function settleUnavailableProfile(
    input: AnalyzeReviewEventInput,
    reviewAnalysisEpoch: number,
    propertyProfileVersion: number,
    status: Exclude<AiPropertyProfileResult['status'], 'available'>,
    nowEpochMillis: number,
    horizonEpochMillis: number | null,
  ): Promise<AnalyzeReviewEventResult> {
    return status === 'not_found' || status === 'policy_unavailable'
      ? deferOrSettle(
          input,
          reviewAnalysisEpoch,
          propertyProfileVersion,
          `property_profile_${status}`,
          nowEpochMillis,
          horizonEpochMillis,
        )
      : settleWithoutResult(
          input,
          reviewAnalysisEpoch,
          propertyProfileVersion,
          'policy_disabled',
        )
  }

  return async (input) => {
    const nowEpochMillis = dependencies.nowEpochMillis()
    const eventHorizonEpochMillis =
      input.eventRecordedAtEpochMillis === null
        ? null
        : input.eventRecordedAtEpochMillis + input.operationHorizonMillis
    const authorization =
      await dependencies.authorization.readMerchantAuthorization(input)
    // No enablement row means no AI lineage: the merchant has never enabled AI
    // for this property. The first enable seeds epoch 1 with its watermark at
    // the allocator head, so every sequence allocated before it sits at or
    // below that watermark by construction, and the enrollment backfill
    // re-allocates the eligible reviews fresh sequences inside the lineage.
    // Acknowledge exactly as consumeNext acknowledges a below-watermark
    // event: a derivative written under an invented epoch 1 would be counted
    // by the lineage the first enable creates and break its exact coverage.
    if (authorization === null) return { status: 'replayed' }
    const reviewAnalysisEpoch = authorization.capabilityEpochs.review_analysis.epoch
    const consumed = await dependencies.reviewEvents.consumeNext({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: input.reviewId,
      sourceEpoch: input.sourceEpoch,
      reviewAnalysisEpoch,
      analysisStartSequence: authorization.reviewAnalysisStartSequence,
      analysisSequence: input.analysisSequence,
      eventEnvelopeId: input.eventEnvelopeId,
      disposition: input.disposition,
    })
    if (consumed.status === 'generation_changed') return { status: 'generation_changed' }
    if (consumed.status === 'duplicate') return { status: 'replayed' }

    const runtime = await dependencies.processingProfiles.readForAi({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
    })
    const profileVersionForSettle =
      runtime.status === 'available' ? runtime.profile.profileVersion : 1
    // A lifecycle transition needs no authorization, profile or provider call.
    // It must always terminal-settle so exact coverage includes the event.
    if (input.disposition !== 'pending') {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profileVersionForSettle,
        input.disposition,
      )
    }
    if (
      authorization.authorizationLineageId === null ||
      ![
        authorization.state === 'enabled',
        authorization.authorizedSourceEpoch === input.sourceEpoch,
        authorization.capabilities.includes('review_analysis'),
        authorization.capabilityRuntimeProfileVersions.review_analysis ===
          PROFILE.capabilityRuntimeProfileVersion,
      ].every(Boolean)
    ) {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profileVersionForSettle,
        'policy_disabled',
      )
    }
    const authorizationLineageId = authorization.authorizationLineageId
    if (runtime.status !== 'available') {
      return settleUnavailableProfile(
        input,
        reviewAnalysisEpoch,
        profileVersionForSettle,
        runtime.status,
        nowEpochMillis,
        eventHorizonEpochMillis,
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
    if (source.status !== 'available') {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        source.status === 'expired' ? 'source_expired' : 'policy_disabled',
      )
    }
    if (source.observation.text === null) {
      return settleWithoutResult(
        input,
        reviewAnalysisEpoch,
        profile.profileVersion,
        'policy_disabled',
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
    const operation = claimed.operation
    if (['succeeded', 'succeeded_pending_delivery'].includes(operation.state)) {
      const settled = await settleReviewAnalysisWithResult(settlementDependencies, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        sourceEpoch: input.sourceEpoch,
        sourceRevision: input.sourceRevision,
        reviewAnalysisEpoch,
        analysisSequence: input.analysisSequence,
        propertyProfileVersion: profile.profileVersion,
        operationId: operation.id,
      })
      if (settled.status === 'generation_changed') {
        return { status: 'generation_changed' }
      }
      await dependencies.operations.markDelivered({
        operationId: operation.id,
        organizationId: input.organizationId,
        expectedAttempt: operation.executionAttempt,
        deliveredAtEpochMillis: nowEpochMillis,
      })
      return { status: 'replayed' }
    }
    async function executeClaimedAnalysis(): Promise<AnalyzeReviewEventResult> {
      // Once an operation exists it gets its event kind's full horizon from its
      // own `createdAt`, so a relay backlog cannot cut short work that has
      // already started. The provider-attempt budget below terminates this
      // path independently, except after a capacity answer: a provider that
      // said "later" has not judged this review, so only the horizon bounds
      // how long we keep asking.
      const operationHorizonEpochMillis = Math.max(
        eventHorizonEpochMillis ?? 0,
        operation.createdAtEpochMillis + input.operationHorizonMillis,
      )
      const expectedAttempt = operation.executionAttempt + 1
      const budgetApplies = !AI_PROVIDER_CAPACITY_CODES.has(operation.failureCode ?? '')
      if (budgetApplies && expectedAttempt > AI_PROVIDER_ATTEMPT_BUDGET) {
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
          operationId: operation.id,
          organizationId: input.organizationId,
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
          // ONE clock read for both instants. Anchoring the backoff to the pre-call
          // `nowEpochMillis` while stamping the failure with a fresh read puts the
          // retry BEFORE the write whenever the provider call outlasts the backoff,
          // and ai_operations_attempt_valid enforces `next_attempt_at >= updated_at`,
          // so the retry write itself threw and the whole request 500'd. aiRetryAt
          // adds at least 1s, so any call slower than that inverted them.
          const failedAtEpochMillis = dependencies.nowEpochMillis()
          const retryAtEpochMillis = aiRetryAt(
            expectedAttempt,
            failedAtEpochMillis,
            response.retryAfterEpochMillis,
            !AI_PROVIDER_CAPACITY_CODES.has(response.code),
          )
          await dependencies.operations.recordFailure({
            operationId: execution.id,
            organizationId: input.organizationId,
            expectedAttempt,
            failureCode: response.code,
            retryAtEpochMillis,
            failedAtEpochMillis,
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
        const parsedAnalysis = AI_ANALYSIS_V2_OUTPUT_SCHEMA.safeParse(response.result)
        if (!parsedAnalysis.success) {
          const failedAtEpochMillis = dependencies.nowEpochMillis()
          const retryAtEpochMillis = aiRetryAt(expectedAttempt, failedAtEpochMillis, null)
          await dependencies.operations.recordFailure({
            operationId: execution.id,
            organizationId: input.organizationId,
            expectedAttempt,
            failureCode: 'output_invalid',
            retryAtEpochMillis,
            failedAtEpochMillis,
          })
          if (retryAtEpochMillis !== null) {
            return {
              status: 'retry',
              retryAtEpochMillis,
              code: 'output_invalid',
            }
          }
          return settleWithoutResult(
            input,
            reviewAnalysisEpoch,
            profile.profileVersion,
            'policy_disabled',
          )
        }
        const analysisResult = parsedAnalysis.data
        const completedAtEpochMillis = response.settlementReceipt.settledAtEpochMillis
        // The merchant notice promises the issue label never reproduces review
        // text. The output schema, the server-side shape check and the SQL
        // CHECK all validate shape only, so a lowercase quotation satisfies
        // every layer. Refuse a multi-word label that appears verbatim in the
        // source; the aspects are the expensive part of the call and stay.
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
          authorizationLineageId,
          reviewAnalysisEpoch,
          propertyProfileVersion: profile.profileVersion,
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
          generatedAtEpochMillis: completedAtEpochMillis,
          expiresAtEpochMillis: completedAtEpochMillis + DERIVATIVE_RETENTION_MILLIS,
        })
        if (!stored) return { status: 'generation_changed' }
        const settled = await settleReviewAnalysisWithResult(settlementDependencies, {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          reviewId: input.reviewId,
          sourceEpoch: input.sourceEpoch,
          sourceRevision: input.sourceRevision,
          reviewAnalysisEpoch,
          analysisSequence: input.analysisSequence,
          propertyProfileVersion: profile.profileVersion,
          operationId: execution.id,
        })
        if (settled.status === 'generation_changed') {
          return { status: 'generation_changed' }
        }
        await dependencies.operations.markDelivered({
          operationId: execution.id,
          organizationId: input.organizationId,
          expectedAttempt,
          deliveredAtEpochMillis: dependencies.nowEpochMillis(),
        })
        return { status: 'completed' }
      } finally {
        await dependencies.quota.release({ quotaId: quota.quotaId })
      }
    }
    return executeClaimedAnalysis()
  }
}
