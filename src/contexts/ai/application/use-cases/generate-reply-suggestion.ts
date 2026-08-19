import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_SOURCE_CANONICALIZER_PROFILE_V1,
} from '#/shared/ai-operation-profiles'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  mapReviewLanguageMetadata,
  type EvaluatedReviewLanguage,
} from '#/shared/ai-review-language-catalogue'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import {
  AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
  type ConcreteReplyLanguageResult,
} from '#/shared/ai-reply-language-verifier'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
  type ReplyTone,
} from '#/shared/ai-reply-template-catalogue'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type { AiInferencePort } from '../ports/ai-inference.port'
import type { AiOperationStorePort } from '../ports/ai-operation-store.port'
import type { AiOutputStorePort } from '../ports/ai-output-store.port'
import type { AiQuotaPort } from '../ports/ai-quota.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { AiExecutionBinding, AiOperationIdentity } from '../../domain/types'
import {
  aiRequestFingerprint,
  aiRetryAt,
  aiReviewSourceProvenance,
  resolveAiExecutionStopFence,
} from '../ai-workflow-support'

const PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === 'reply-suggestion-v1',
)!

export type GenerateReplySuggestionInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  actorUserId: UserId
  tone: ReplyTone
  idempotencyKey: string
  expectedSourceEpoch: number
  expectedSourceRevision: number
  expectedBaseReplyStateRevision: number
}>

export type GenerateReplySuggestionResult =
  | Readonly<{
      status: 'ready'
      replyText: string
      provenanceToken: string
      expiresAtEpochMillis: number
      baseReplyStateRevision: number
    }>
  | Readonly<{
      status: 'unavailable'
      code:
        | 'not_authorized'
        | 'source_changed'
        | 'language_not_supported'
        | 'policy_unavailable'
        | 'completed_without_delivery'
        | 'provider_unavailable'
      retryAfterEpochMillis: number | null
    }>

export type GenerateReplySuggestionDependencies = Readonly<{
  authorization: AiAuthorizationPort
  control: AiControlPort
  inference: AiInferencePort
  operations: AiOperationStorePort
  outputs: AiOutputStorePort
  quota: AiQuotaPort
  reviewSources: AiReviewSourcePort
  processingProfiles: PropertyProcessingProfilePort
  resolveReplyLanguage(
    input: Readonly<{
      text: string
      evaluatedLanguage: EvaluatedReviewLanguage
    }>,
  ): Promise<ConcreteReplyLanguageResult>
  nowEpochMillis: () => number
}>

function unavailable(
  code: Extract<GenerateReplySuggestionResult, { status: 'unavailable' }>['code'],
  retryAfterEpochMillis: number | null = null,
): GenerateReplySuggestionResult {
  return { status: 'unavailable', code, retryAfterEpochMillis }
}

export function createGenerateReplySuggestion(
  dependencies: GenerateReplySuggestionDependencies,
): (input: GenerateReplySuggestionInput) => Promise<GenerateReplySuggestionResult> {
  return async (input) => {
    const nowEpochMillis = dependencies.nowEpochMillis()
    const [authorization, runtime, source, baseReplyStateRevision] = await Promise.all([
      dependencies.authorization.readMerchantAuthorization(input),
      dependencies.processingProfiles.readForAi(input),
      dependencies.reviewSources.readForAi({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        expected: {
          kind: 'reply',
          sourceEpoch: input.expectedSourceEpoch,
          sourceRevision: input.expectedSourceRevision,
        },
      }),
      dependencies.reviewSources.readReplyStateRevision(input),
    ])
    if (
      authorization === null ||
      authorization.state !== 'enabled' ||
      authorization.authorizationLineageId === null ||
      authorization.authorizedSourceEpoch !== input.expectedSourceEpoch ||
      !authorization.capabilities.includes('reply_drafting') ||
      authorization.capabilityRuntimeProfileVersions.reply_drafting !==
        PROFILE.capabilityRuntimeProfileVersion ||
      runtime.status !== 'available'
    ) {
      return unavailable('not_authorized')
    }
    if (
      source.status !== 'available' ||
      source.observation.text === null ||
      baseReplyStateRevision !== input.expectedBaseReplyStateRevision
    ) {
      return unavailable('source_changed')
    }
    const observation = source.observation
    const reviewText = observation.text
    if (reviewText === null) return unavailable('source_changed')
    const evaluatedLanguage = mapReviewLanguageMetadata(observation.languageCode)
    if (evaluatedLanguage.status !== 'supported') {
      return unavailable(
        evaluatedLanguage.status === 'language_not_supported'
          ? 'language_not_supported'
          : 'policy_unavailable',
      )
    }
    const concreteLanguage = await dependencies.resolveReplyLanguage({
      text: reviewText,
      evaluatedLanguage: evaluatedLanguage.language,
    })
    if (concreteLanguage.status !== 'resolved') {
      return unavailable(
        concreteLanguage.status === 'language_not_supported'
          ? 'language_not_supported'
          : 'policy_unavailable',
      )
    }
    const stopFence = await resolveAiExecutionStopFence(dependencies.control, {
      providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
      capability: 'reply_drafting',
    })
    if (stopFence === null) return unavailable('policy_unavailable')

    const canonicalSource = encodeCanonicalAiReviewSource({
      text: reviewText,
      rating: observation.rating,
      languageCode: observation.languageCode,
      reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
    })
    const sourceProvenance = aiReviewSourceProvenance(canonicalSource.bytes)
    canonicalSource.bytes.fill(0)
    const profile = runtime.profile
    const replyDraftingEpoch = authorization.capabilityEpochs.reply_drafting.epoch
    const identity: AiOperationIdentity = {
      subjectKind: 'property',
      command: 'reply',
      capability: 'reply_drafting',
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      actorId: input.actorUserId,
      systemPrincipal: null,
      reviewId: input.reviewId,
      sourceEpoch: input.expectedSourceEpoch,
      sourceRevision: input.expectedSourceRevision,
      tone: input.tone,
      reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
      baseReplyStateRevision,
    }
    const binding: AiExecutionBinding = {
      authorizationLineageId: authorization.authorizationLineageId,
      noticeVersion: authorization.noticeVersion,
      noticeDigest: authorization.noticeDigest,
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch,
        baseReplyStateRevision,
      },
      sourceEpoch: input.expectedSourceEpoch,
      evaluatedLanguage: evaluatedLanguage.language.group,
      concreteReplyLanguage: concreteLanguage.language,
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
      languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
      zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
      sourceRevision: input.expectedSourceRevision,
      reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
      propertyProfileVersion: profile.profileVersion,
      routingPolicyVersion: profile.routingPolicyVersion,
      sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
      sourceCanonicalizerDigest:
        AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
      redactionProfileVersion: authorization.redactionProfileFamily,
      outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
      outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
      replyTemplateCatalogueVersion: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
      operationProfileVersion: PROFILE.profileVersion,
      capabilityRuntimeProfileVersion: PROFILE.capabilityRuntimeProfileVersion!,
      aiSubjectHmacKeyVersion: null,
      stopFence,
    }
    const requestFingerprint = aiRequestFingerprint({
      identity,
      binding,
      sourceProvenance,
    })
    const claimed = await dependencies.operations.claim({
      identity,
      binding,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      sourceProvenance,
      nowEpochMillis,
      expiresAtEpochMillis: nowEpochMillis + 15 * 60 * 1_000,
    })
    if (claimed.status === 'conflict') return unavailable('policy_unavailable')
    if (
      claimed.operation.state === 'succeeded' ||
      claimed.operation.state === 'succeeded_pending_delivery'
    ) {
      return unavailable('completed_without_delivery')
    }
    const expectedAttempt = claimed.operation.executionAttempt + 1
    if (expectedAttempt > 4) return unavailable('provider_unavailable')
    const quota = await dependencies.quota.acquire({
      propertyId: input.propertyId,
      capability: 'reply_drafting',
      nowEpochMillis,
    })
    if (!quota.ok) {
      return unavailable('provider_unavailable', nowEpochMillis + 5_000)
    }
    try {
      const execution = await dependencies.operations.claimExecution({
        operationId: claimed.operation.id,
        expectedAttempt,
        nowEpochMillis,
      })
      if (execution === null || execution.executionPermitId === null) {
        return unavailable('provider_unavailable', nowEpochMillis + 1_000)
      }
      const response = await dependencies.inference.generateReply(
        {
          route: 'reply-suggestion',
          operationId: execution.id,
          permitId: execution.executionPermitId,
          attemptNumber: expectedAttempt,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          internalSubjectId: input.reviewId,
          actorId: input.actorUserId,
          binding,
          deadlineEpochMillis: nowEpochMillis + PROFILE.requestDeadlineMs,
          redactionCountry: profile.countryCode,
          observedContentExpiresAtEpochMillis: observation.contentExpiresAtEpochMillis,
          tone: input.tone,
          source: {
            kind: 'review',
            text: reviewText,
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
        return unavailable('provider_unavailable', retryAtEpochMillis)
      }
      const [currentAuthorization, currentSource, currentReplyStateRevision] =
        await Promise.all([
          dependencies.authorization.readMerchantAuthorization(input),
          dependencies.reviewSources.assertCurrent({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            reviewId: input.reviewId,
            expected: {
              kind: 'reply',
              sourceEpoch: input.expectedSourceEpoch,
              sourceRevision: input.expectedSourceRevision,
            },
          }),
          dependencies.reviewSources.readReplyStateRevision(input),
        ])
      if (
        currentAuthorization?.authorizationLineageId !==
          authorization.authorizationLineageId ||
        currentAuthorization.state !== 'enabled' ||
        currentAuthorization.capabilityEpochs.reply_drafting.epoch !==
          replyDraftingEpoch ||
        currentSource.status !== 'current' ||
        currentReplyStateRevision !== baseReplyStateRevision
      ) {
        return unavailable('source_changed')
      }
      const completedAtEpochMillis = response.settlementReceipt.settledAtEpochMillis
      const settled = await dependencies.outputs.settleEphemeralReply({
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
        actorUserId: input.actorUserId,
        sourceEpoch: input.expectedSourceEpoch,
        sourceRevision: input.expectedSourceRevision,
        baseReplyStateRevision,
        authorizationLineageId: authorization.authorizationLineageId,
        replyDraftingEpoch,
        propertyProfileVersion: profile.profileVersion,
        replyProfileVersion: PROFILE.profileVersion,
      })
      if (!settled) return unavailable('source_changed')
      await dependencies.operations.markDelivered({
        operationId: execution.id,
        expectedAttempt,
        deliveredAtEpochMillis: dependencies.nowEpochMillis(),
      })
      return {
        status: 'ready',
        replyText: response.result.replyText,
        provenanceToken: response.result.provenanceToken,
        expiresAtEpochMillis: response.result.expiresAtEpochMillis,
        baseReplyStateRevision,
      }
    } finally {
      await dependencies.quota.release({ quotaId: quota.quotaId })
    }
  }
}
