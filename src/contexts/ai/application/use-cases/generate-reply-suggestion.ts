import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_SOURCE_CANONICALIZER_PROFILE_V1,
} from '#/shared/ai-operation-profiles'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  mapReviewLanguageMetadata,
  parseCanonicalReplyLanguageTag,
  type ConcreteReplyLanguage,
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
  resolveAiReplyTemplate,
  type ReplyTone,
} from '#/shared/ai-reply-template-catalogue'
import {
  AI_PERSONALIZED_REPLY_LANGUAGES,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from '#/shared/ai-personalized-reply-contract'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type { AiInferencePort } from '../ports/ai-inference.port'
import type { AiOperationStorePort } from '../ports/ai-operation-store.port'
import type { AiOutputStorePort } from '../ports/ai-output-store.port'
import type { AiQuotaPort } from '../ports/ai-quota.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type {
  AiExecutionBinding,
  AiOperationId,
  AiOperationIdentity,
} from '../../domain/types'
import type { AiErrorCode } from '../../domain/errors'
import {
  aiRequestFingerprint,
  aiRetryAt,
  aiReviewSourceProvenance,
  resolveAiExecutionStopFence,
} from '../ai-workflow-support'

const REPLY_OPERATION_PROFILE_VERSION = 'reply-suggestion-v1' as const
const PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === REPLY_OPERATION_PROFILE_VERSION,
)!

export type GenerateReplySuggestionInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  actorUserId: UserId
  tone: ReplyTone
  targetLanguage:
    Readonly<{ kind: 'property_default' }> | Readonly<{ kind: 'review_language' }>
  idempotencyKey: string
  /** Explicitly request the governed local catalogue without AI admission or execution. */
  templateOnly?: boolean
  expectedSourceEpoch: number
  expectedSourceRevision: number
  expectedBaseReplyStateRevision: number
}>

export type GenerateReplySuggestionResult =
  | Readonly<{
      status: 'ready'
      profileVersion: typeof AI_PERSONALIZED_REPLY_PROFILE_VERSION
      replyText: string
      provenanceToken: string
      expiresAtEpochMillis: number
      baseReplyStateRevision: number
      concreteLanguageTag: string
    }>
  | Readonly<{
      status: 'fallback'
      /** Local, deterministic copy — never represented as provider-generated. */
      kind: 'local_safe_template'
      reason:
        'provider_or_output_unavailable' | 'language_undetermined' | 'no_review_text'
      languageSource: 'explicit' | 'property_default'
      replyText: string
      concreteLanguageTag: string
    }>
  | Readonly<{
      status: 'unavailable'
      code:
        | 'not_authorized'
        | 'source_changed'
        // A language exists in the catalogue but has no reply templates.
        | 'language_not_supported'
        // The property has no configured default, or the persisted value no
        // longer resolves through the pinned concrete-language catalogue.
        | 'target_language_unavailable'
        | 'brand_profile_unavailable'
        | 'brand_profile_changed'
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
  propertyReplyLanguages: Readonly<{
    readDefaultReplyLanguage(
      input: Readonly<{
        organizationId: OrganizationId
        propertyId: PropertyId
      }>,
    ): Promise<string | null>
  }>
  replyBrandProfiles: Pick<
    PortalAiReplyBrandProfilePublicApi,
    'readCurrentAiReplyBrandProfile'
  >
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

const PERSONALIZED_LANGUAGE_SET: ReadonlySet<string> = new Set(
  AI_PERSONALIZED_REPLY_LANGUAGES,
)

type FallbackResult = Extract<GenerateReplySuggestionResult, { status: 'fallback' }>

function localFallback(
  input: Pick<GenerateReplySuggestionInput, 'tone'>,
  language: ConcreteReplyLanguage,
  rating: 1 | 2 | 3 | 4 | 5,
  metadata: Pick<FallbackResult, 'reason' | 'languageSource'>,
): GenerateReplySuggestionResult {
  const templateId =
    rating === 1
      ? 'recovery_service'
      : rating === 2
        ? 'acknowledge_concern'
        : rating === 3
          ? 'appreciation_neutral'
          : 'appreciation_positive'
  try {
    return {
      status: 'fallback',
      kind: 'local_safe_template',
      reason: metadata.reason,
      languageSource: metadata.languageSource,
      replyText: resolveAiReplyTemplate({
        templateGroup: language.templateGroup,
        tone: input.tone,
        templateId,
      }),
      concreteLanguageTag: language.tag,
    }
  } catch {
    return unavailable('provider_unavailable')
  }
}

function canOfferLocalFallback(code: string): boolean {
  return (
    code === 'provider_unavailable' ||
    code === 'provider_rate_limited' ||
    code === 'provider_refused' ||
    code === 'output_invalid' ||
    code === 'output_truncated'
  )
}

type ResolvedTargetReplyLanguage = Readonly<{
  language: ConcreteReplyLanguage
  languageSource: FallbackResult['languageSource']
}>

type ReplyProviderFailure = Readonly<{
  operationId: AiOperationId
  organizationId: OrganizationId
  expectedAttempt: number
  failureCode: AiErrorCode
  providerRetryAfterEpochMillis: number | null
}>

async function recordReplyProviderFailure(
  dependencies: Pick<
    GenerateReplySuggestionDependencies,
    'operations' | 'nowEpochMillis'
  >,
  failure: ReplyProviderFailure,
): Promise<number | null> {
  // ONE clock read for both instants. Anchoring the backoff to the pre-call
  // clock while stamping failure with a fresh read can put retry before write
  // when provider work outlasts the backoff. aiRetryAt preserves the ordering.
  const failedAtEpochMillis = dependencies.nowEpochMillis()
  const retryAtEpochMillis = aiRetryAt(
    failure.expectedAttempt,
    failedAtEpochMillis,
    failure.providerRetryAfterEpochMillis,
  )
  await dependencies.operations.recordFailure({
    operationId: failure.operationId,
    organizationId: failure.organizationId,
    expectedAttempt: failure.expectedAttempt,
    failureCode: failure.failureCode,
    retryAtEpochMillis,
    failedAtEpochMillis,
  })
  return retryAtEpochMillis
}

async function resolveTargetReplyLanguage(
  dependencies: Pick<GenerateReplySuggestionDependencies, 'propertyReplyLanguages'>,
  input: GenerateReplySuggestionInput,
  reviewLanguage: ConcreteReplyLanguage | null,
): Promise<ResolvedTargetReplyLanguage | null> {
  if (input.targetLanguage.kind === 'review_language' && reviewLanguage !== null) {
    return { language: reviewLanguage, languageSource: 'explicit' }
  }
  const configured = await dependencies.propertyReplyLanguages.readDefaultReplyLanguage({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
  })
  const language = configured === null ? null : parseCanonicalReplyLanguageTag(configured)
  return language === null
    ? null
    : {
        language,
        languageSource:
          input.targetLanguage.kind === 'review_language'
            ? 'property_default'
            : 'explicit',
      }
}

async function isReplySuggestionStillCurrent(
  dependencies: Pick<
    GenerateReplySuggestionDependencies,
    'authorization' | 'reviewSources' | 'replyBrandProfiles'
  >,
  input: GenerateReplySuggestionInput,
  expected: Readonly<{
    authorizationLineageId: string
    replyDraftingEpoch: number
    baseReplyStateRevision: number
    replyBrandProfileVersion: number
    replyBrandDisplayName: string
    replyBrandDisplayNameDigest: string
  }>,
): Promise<'current' | 'source_changed' | 'brand_profile_changed'> {
  const [authorization, source, replyStateRevision, brandProfile] = await Promise.all([
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
    dependencies.replyBrandProfiles.readCurrentAiReplyBrandProfile(
      input.organizationId,
      input.propertyId,
    ),
  ])
  if (
    brandProfile === null ||
    brandProfile.version !== expected.replyBrandProfileVersion ||
    brandProfile.displayName !== expected.replyBrandDisplayName ||
    brandProfile.displayNameDigest !== expected.replyBrandDisplayNameDigest
  ) {
    return 'brand_profile_changed'
  }
  return authorization?.authorizationLineageId === expected.authorizationLineageId &&
    authorization.state === 'enabled' &&
    authorization.capabilityEpochs.reply_drafting.epoch === expected.replyDraftingEpoch &&
    source.status === 'current' &&
    replyStateRevision === expected.baseReplyStateRevision
    ? 'current'
    : 'source_changed'
}

export function createGenerateReplySuggestion(
  dependencies: GenerateReplySuggestionDependencies,
): (input: GenerateReplySuggestionInput) => Promise<GenerateReplySuggestionResult> {
  return async (input) => {
    const [source, baseReplyStateRevision] = await Promise.all([
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
      source.status !== 'available' ||
      baseReplyStateRevision !== input.expectedBaseReplyStateRevision
    ) {
      return unavailable('source_changed')
    }

    const observation = source.observation
    if (observation.text === null) {
      const target = await resolveTargetReplyLanguage(dependencies, input, null)
      return target === null
        ? unavailable('target_language_unavailable')
        : localFallback(input, target.language, observation.rating, {
            reason: 'no_review_text',
            languageSource: target.languageSource,
          })
    }

    const reviewText = observation.text
    const evaluatedLanguage = mapReviewLanguageMetadata(observation.languageCode)
    if (evaluatedLanguage.status !== 'supported') {
      if (!input.templateOnly) {
        return unavailable(
          evaluatedLanguage.status === 'language_not_supported'
            ? 'language_not_supported'
            : 'policy_unavailable',
        )
      }
      const target = await resolveTargetReplyLanguage(dependencies, input, null)
      return target === null
        ? unavailable('target_language_unavailable')
        : localFallback(input, target.language, observation.rating, {
            reason: 'language_undetermined',
            languageSource: target.languageSource,
          })
    }

    const reviewLanguage = await dependencies.resolveReplyLanguage({
      text: reviewText,
      evaluatedLanguage: evaluatedLanguage.language,
    })
    if (reviewLanguage.status !== 'resolved') {
      const canUseTemplate =
        input.templateOnly ||
        (reviewLanguage.status === 'language_not_supported' &&
          reviewLanguage.reason !== 'metadata_language_mismatch')
      if (!canUseTemplate) {
        return unavailable(
          reviewLanguage.status === 'language_not_supported'
            ? 'language_not_supported'
            : 'policy_unavailable',
        )
      }
      const target = await resolveTargetReplyLanguage(dependencies, input, null)
      return target === null
        ? unavailable('target_language_unavailable')
        : localFallback(input, target.language, observation.rating, {
            reason: 'language_undetermined',
            languageSource: target.languageSource,
          })
    }

    const target = await resolveTargetReplyLanguage(
      dependencies,
      input,
      reviewLanguage.language,
    )
    if (target === null) return unavailable('target_language_unavailable')
    const targetReplyLanguage = target.language
    if (
      input.templateOnly ||
      !PERSONALIZED_LANGUAGE_SET.has(targetReplyLanguage.templateGroup)
    ) {
      return localFallback(input, targetReplyLanguage, observation.rating, {
        reason: 'provider_or_output_unavailable',
        languageSource: target.languageSource,
      })
    }

    const [authorization, runtime, brandProfile] = await Promise.all([
      dependencies.authorization.readMerchantAuthorization(input),
      dependencies.processingProfiles.readForAi(input),
      dependencies.replyBrandProfiles.readCurrentAiReplyBrandProfile(
        input.organizationId,
        input.propertyId,
      ),
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
    if (brandProfile === null) return unavailable('brand_profile_unavailable')
    const nowEpochMillis = dependencies.nowEpochMillis()
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
    const currentnessFence = {
      authorizationLineageId: authorization.authorizationLineageId,
      replyDraftingEpoch,
      baseReplyStateRevision,
      replyBrandProfileVersion: brandProfile.version,
      replyBrandDisplayName: brandProfile.displayName,
      replyBrandDisplayNameDigest: brandProfile.displayNameDigest,
    }
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
      concreteReplyLanguage: targetReplyLanguage,
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
      languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
      zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
      sourceRevision: input.expectedSourceRevision,
      reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
      propertyProfileVersion: profile.profileVersion,
      replyBrandProfileVersion: brandProfile.version,
      replyBrandDisplayNameDigest: brandProfile.displayNameDigest,
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
        organizationId: input.organizationId,
        expectedAttempt,
        nowEpochMillis,
      })
      if (execution === null || execution.executionPermitId === null) {
        return unavailable('provider_unavailable', nowEpochMillis + 1_000)
      }
      const response = await dependencies.inference.generateReply(
        {
          route: 'reply-suggestion',
          replyProfileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
          brandProfile: { displayName: brandProfile.displayName },
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
        const retryAtEpochMillis = await recordReplyProviderFailure(dependencies, {
          operationId: execution.id,
          organizationId: input.organizationId,
          expectedAttempt,
          failureCode: response.code,
          providerRetryAfterEpochMillis: response.retryAfterEpochMillis,
        })
        if (canOfferLocalFallback(response.code)) {
          const currentness = await isReplySuggestionStillCurrent(
            dependencies,
            input,
            currentnessFence,
          )
          if (currentness !== 'current') {
            return unavailable(currentness)
          }
          return localFallback(input, targetReplyLanguage, observation.rating, {
            reason: 'provider_or_output_unavailable',
            languageSource: target.languageSource,
          })
        }
        return unavailable('provider_unavailable', retryAtEpochMillis)
      }
      const currentness = await isReplySuggestionStillCurrent(
        dependencies,
        input,
        currentnessFence,
      )
      if (currentness !== 'current') {
        return unavailable(currentness)
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
        replyBrandProfileVersion: brandProfile.version,
        replyBrandDisplayNameDigest: brandProfile.displayNameDigest,
        operationProfileVersion: REPLY_OPERATION_PROFILE_VERSION,
        replyProfileVersion: response.result.profileVersion,
      })
      if (!settled) {
        const settlementCurrentness = await isReplySuggestionStillCurrent(
          dependencies,
          input,
          currentnessFence,
        )
        return unavailable(
          settlementCurrentness === 'current' ? 'source_changed' : settlementCurrentness,
        )
      }
      await dependencies.operations.markDelivered({
        operationId: execution.id,
        organizationId: input.organizationId,
        expectedAttempt,
        deliveredAtEpochMillis: dependencies.nowEpochMillis(),
      })
      return {
        status: 'ready',
        profileVersion: response.result.profileVersion,
        replyText: response.result.replyText,
        provenanceToken: response.result.provenanceToken,
        expiresAtEpochMillis: response.result.expiresAtEpochMillis,
        baseReplyStateRevision,
        concreteLanguageTag: targetReplyLanguage.tag,
      }
    } finally {
      await dependencies.quota.release({ quotaId: quota.quotaId })
    }
  }
}
