import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import {
  manageReplyDraftingRequests,
  admitReplyDraft,
  reportReplyReading,
  deliveredReplyFrame,
  replyProgressArguments,
  assertReplyDraftSourceCurrent,
  publishReplyDraftingIdentity,
  replyUnavailable as unavailable,
  hasProducedDraft,
  isReplyDraftingIdentityCurrent,
  PERSONALIZED_LANGUAGE_SET,
} from '../reply-drafting-requests'
import type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
  GenerateReplySuggestionDependencies,
} from '../reply-suggestion-contract'
export type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
  GenerateReplySuggestionDependencies,
} from '../reply-suggestion-contract'
import { REPLY_DRAFTING_V2_OPERATION_PROFILE } from '#/shared/reply-drafting-v2-profile'
import {
  REPLY_DRAFTING_V2_SERVED_LANGUAGES,
  REPLY_DRAFTING_V2_VERSIONS,
} from '#/shared/reply-drafting-v2-schema'
import {
  bindReplyDraftingV2,
  replyDraftingV2GenerationSeed,
  selectedReplyDraftingAttempt,
  rewriteReplyDraftingV2,
  releaseReplyAdmissionOnce,
  admitInteractiveDraft,
  type ReplyDraftingV2Attempt,
} from '../reply-drafting-v2-workflow'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
} from '#/shared/ai-operation-profiles'
import {
  mapReviewLanguageMetadata,
  parseCanonicalReplyLanguageTag,
  type ConcreteReplyLanguage,
  type EvaluatedReviewLanguage,
  type ReplyTemplateLanguageGroup,
} from '#/shared/ai-review-language-catalogue'
import { resolveAiReplyTemplate } from '#/shared/ai-reply-template-catalogue'
import { AI_PERSONALIZED_REPLY_PROFILE_VERSION } from '#/shared/ai-personalized-reply-contract'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type {
  AiExecutionStopFence,
  AiOperationId,
  AiPropertyProcessingProfile,
} from '../../domain/types'
import type { AiErrorCode } from '../../domain/errors'
import {
  AI_PROVIDER_CHARGED_CODES,
  aiRequestFingerprint,
  aiRetryAt,
  aiReviewSourceProvenance,
  isAiAuthorizationUnderServedContract,
  resolveAiExecutionStopFence,
} from '../ai-workflow-support'
import { replyExecutionBinding, replyOperationIdentity } from '../ai-operation-binding'

const REPLY_OPERATION_PROFILE_VERSION = 'reply-suggestion-v1' as const
const PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === REPLY_OPERATION_PROFILE_VERSION,
)!

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
  // A charged answer ends the operation under its own code: admission refuses
  // any later attempt of it, and the composer asks again under a new key, so a
  // scheduled retry only waited to be reaped as `operation_abandoned`.
  const retryAtEpochMillis = AI_PROVIDER_CHARGED_CODES.has(failure.failureCode)
    ? null
    : aiRetryAt(
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
    'authorization' | 'reviewSources' | 'replyBrandProfiles' | 'replyVoices'
  >,
  input: GenerateReplySuggestionInput,
  expected: Readonly<{
    authorizationLineageId: string
    replyDraftingEpoch: number
    baseReplyStateRevision: number
    replyBrandProfileVersion: number
    replyBrandDisplayName: string
    replyBrandDisplayNameDigest: string
    voiceDigest: string | null
    authorizationStateVersion?: number
    noticeVersion?: string
    noticeDigest?: string
    languageGroup: ReplyTemplateLanguageGroup
  }>,
): Promise<'current' | 'source_changed' | 'brand_profile_changed' | 'voice_changed'> {
  const [authorization, source, replyStateRevision, brandProfile, localFrame] =
    await Promise.all([
      dependencies.authorization.readMerchantAuthorization(input),
      assertReplyDraftSourceCurrent(dependencies.reviewSources, input, {
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
      dependencies.replyVoices?.resolveLocalFrame({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        languageGroup: expected.languageGroup,
      }) ?? Promise.resolve(null),
    ])
  if (
    brandProfile === null ||
    brandProfile.version !== expected.replyBrandProfileVersion ||
    brandProfile.displayName !== expected.replyBrandDisplayName ||
    brandProfile.displayNameDigest !== expected.replyBrandDisplayNameDigest
  ) {
    return 'brand_profile_changed'
  }
  if ((localFrame?.voiceDigest ?? null) !== expected.voiceDigest) return 'voice_changed'
  if (
    expected.authorizationStateVersion !== undefined &&
    (authorization?.stateVersion !== expected.authorizationStateVersion ||
      authorization?.noticeVersion !== expected.noticeVersion ||
      authorization?.noticeDigest !== expected.noticeDigest)
  )
    return 'source_changed'
  return authorization?.authorizationLineageId === expected.authorizationLineageId &&
    authorization.state === 'enabled' &&
    authorization.capabilityEpochs.reply_drafting.epoch === expected.replyDraftingEpoch &&
    source.status === 'current' &&
    replyStateRevision === expected.baseReplyStateRevision
    ? 'current'
    : 'source_changed'
}

type ReviewObservation = Extract<
  Awaited<ReturnType<AiReviewSourcePort['readForAi']>>,
  { status: 'available' }
>['observation']

type MerchantAuthorization = NonNullable<
  Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>
>

type ReplyDraftingAuthorization = MerchantAuthorization &
  Readonly<{ authorizationLineageId: string }>

type SuggestionLanguage =
  // Answered without provider work: a local template or a refusal.
  | Readonly<{ kind: 'settled'; result: GenerateReplySuggestionResult }>
  // A personalized draft in this language may be requested from the provider.
  | Readonly<{
      kind: 'draftable'
      reviewText: string
      evaluatedLanguage: EvaluatedReviewLanguage
      concreteReplyLanguage: ConcreteReplyLanguage
    }>

const settledWith = (result: GenerateReplySuggestionResult): SuggestionLanguage => ({
  kind: 'settled',
  result,
})

/**
 * A local template in a target language chosen without a review language, or
 * the refusal when the Property has none that resolves.
 */
async function templateWithoutReviewLanguage(
  dependencies: Pick<GenerateReplySuggestionDependencies, 'propertyReplyLanguages'>,
  input: GenerateReplySuggestionInput,
  rating: ReviewObservation['rating'],
  reason: Extract<FallbackResult['reason'], 'no_review_text' | 'language_undetermined'>,
): Promise<GenerateReplySuggestionResult> {
  const target = await resolveTargetReplyLanguage(dependencies, input, null)
  return target === null
    ? unavailable('target_language_unavailable')
    : localFallback(input, target.language, rating, {
        reason,
        languageSource: target.languageSource,
      })
}

/**
 * Decides the draft's language before any AI authorization is read. A review
 * without text, metadata or text in no supported language, an explicit
 * template request, and a target language with no personalized profile each
 * settle here with a local template or a refusal; only a target language that
 * can be personalized goes on to provider work.
 */
async function resolveSuggestionLanguage(
  dependencies: Pick<
    GenerateReplySuggestionDependencies,
    'propertyReplyLanguages' | 'resolveReplyLanguage'
  >,
  input: GenerateReplySuggestionInput,
  observation: ReviewObservation,
  personalizedLanguages: ReadonlySet<string> = PERSONALIZED_LANGUAGE_SET,
): Promise<SuggestionLanguage> {
  if (observation.text === null) {
    return settledWith(
      await templateWithoutReviewLanguage(
        dependencies,
        input,
        observation.rating,
        'no_review_text',
      ),
    )
  }
  const reviewText = observation.text
  const evaluatedLanguage = mapReviewLanguageMetadata(observation.languageCode)
  if (evaluatedLanguage.status !== 'supported') {
    if (!input.templateOnly) {
      return settledWith(
        unavailable(
          evaluatedLanguage.status === 'language_not_supported'
            ? 'language_not_supported'
            : 'policy_unavailable',
        ),
      )
    }
    return settledWith(
      await templateWithoutReviewLanguage(
        dependencies,
        input,
        observation.rating,
        'language_undetermined',
      ),
    )
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
      return settledWith(
        unavailable(
          reviewLanguage.status === 'language_not_supported'
            ? 'language_not_supported'
            : 'policy_unavailable',
        ),
      )
    }
    return settledWith(
      await templateWithoutReviewLanguage(
        dependencies,
        input,
        observation.rating,
        'language_undetermined',
      ),
    )
  }

  const target = await resolveTargetReplyLanguage(
    dependencies,
    input,
    reviewLanguage.language,
  )
  if (target === null) return settledWith(unavailable('target_language_unavailable'))
  if (input.templateOnly) {
    return settledWith(
      localFallback(input, target.language, observation.rating, {
        reason: 'template_requested',
        languageSource: target.languageSource,
      }),
    )
  }
  if (!personalizedLanguages.has(target.language.templateGroup)) {
    return settledWith(
      localFallback(input, target.language, observation.rating, {
        reason: 'language_not_personalized',
        languageSource: target.languageSource,
      }),
    )
  }
  return {
    kind: 'draftable',
    reviewText,
    evaluatedLanguage: evaluatedLanguage.language,
    concreteReplyLanguage: target.language,
  }
}

/**
 * The AccountAdmin authorization a personalized draft may run under: enabled,
 * with a lineage, for the source epoch the manager saw, and granting reply
 * drafting; execution compatibility is checked separately.
 */
function isReplyDraftingAuthorized(
  authorization: MerchantAuthorization | null,
  input: Pick<GenerateReplySuggestionInput, 'expectedSourceEpoch'>,
): authorization is ReplyDraftingAuthorization {
  return (
    authorization !== null &&
    authorization.state === 'enabled' &&
    authorization.authorizationLineageId !== null &&
    authorization.authorizedSourceEpoch === input.expectedSourceEpoch &&
    authorization.capabilities.includes('reply_drafting')
  )
}

type ReplyBrandProfile = NonNullable<
  Awaited<
    ReturnType<
      GenerateReplySuggestionDependencies['replyBrandProfiles']['readCurrentAiReplyBrandProfile']
    >
  >
>

type DraftingGrant =
  // The refusal the manager is shown.
  | Readonly<{ kind: 'refused'; result: GenerateReplySuggestionResult }>
  | Readonly<{
      kind: 'granted'
      authorization: ReplyDraftingAuthorization
      profile: AiPropertyProcessingProfile
      brandProfile: ReplyBrandProfile
      stopFence: AiExecutionStopFence
    }>

const refusedWith = (...refusal: Parameters<typeof unavailable>): DraftingGrant => ({
  kind: 'refused',
  result: unavailable(...refusal),
})

/**
 * Everything a personalized draft runs under, read before an operation is
 * claimed: the AccountAdmin authorization and the notice it was recorded
 * under, the Property's processing profile and public display name, and the AI
 * execution controls. The first one that is missing is the refusal.
 */
async function resolveDraftingGrant(
  dependencies: Pick<
    GenerateReplySuggestionDependencies,
    'authorization' | 'processingProfiles' | 'replyBrandProfiles' | 'control'
  >,
  input: GenerateReplySuggestionInput,
): Promise<DraftingGrant> {
  const [authorization, runtime, brandProfile] = await Promise.all([
    dependencies.authorization.readMerchantAuthorization(input),
    dependencies.processingProfiles.readForAi(input),
    dependencies.replyBrandProfiles.readCurrentAiReplyBrandProfile(
      input.organizationId,
      input.propertyId,
    ),
  ])
  if (!isReplyDraftingAuthorized(authorization, input)) {
    return refusedWith('not_authorized')
  }
  // Enabled, but under a notice this build no longer holds in force. The
  // gateway would refuse the request by throwing once an attempt is claimed, so
  // the manager is told here what the Property needs.
  if (!isAiAuthorizationUnderServedContract(authorization, 'reply_drafting')) {
    return refusedWith('consent_renewal_required')
  }
  if (runtime.status !== 'available') return refusedWith('not_authorized')
  if (brandProfile === null) return refusedWith('brand_profile_unavailable')
  const stopFence = await resolveAiExecutionStopFence(dependencies.control, {
    providerDeploymentProfileVersion:
      getAiRuntimeCapability('reply_drafting').providerDeploymentProfileVersion,
    capability: 'reply_drafting',
  })
  if (stopFence === null) return refusedWith('policy_unavailable')
  return {
    kind: 'granted',
    authorization,
    profile: runtime.profile,
    brandProfile,
    stopFence,
  }
}

export function createGenerateReplySuggestion(
  dependencies: GenerateReplySuggestionDependencies,
  v2Attempt?: ReplyDraftingV2Attempt,
): (input: GenerateReplySuggestionInput) => Promise<GenerateReplySuggestionResult> {
  const v2 = selectedReplyDraftingAttempt(v2Attempt)
  const operationProfile = v2 ? REPLY_DRAFTING_V2_OPERATION_PROFILE : PROFILE
  // fallow-ignore-next-line complexity -- fail-closed AI operation lifecycle must settle every claimed state in one boundary
  const generate = manageReplyDraftingRequests(dependencies, v2, async (input) => {
    const [source, baseReplyStateRevision] = await Promise.all([
      dependencies.reviewSources.readForAi({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        ...(v2 ? { sentences: true } : {}),
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
    const language = await resolveSuggestionLanguage(
      dependencies,
      input,
      observation,
      v2 ? new Set(REPLY_DRAFTING_V2_SERVED_LANGUAGES) : PERSONALIZED_LANGUAGE_SET,
    )
    if (language.kind === 'settled') {
      if (language.result.status !== 'fallback') return language.result
      const fallbackLanguage = parseCanonicalReplyLanguageTag(
        language.result.concreteLanguageTag,
      )
      const frame = fallbackLanguage
        ? ((await dependencies.replyVoices?.resolveLocalFrame({
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            reviewId: input.reviewId,
            languageGroup: fallbackLanguage.templateGroup,
          })) ?? null)
        : null
      return frame === null
        ? language.result
        : {
            ...language.result,
            replyText: [frame.prefix, language.result.replyText, frame.suffix]
              .filter(Boolean)
              .join('\n\n'),
          }
    }
    const { reviewText, concreteReplyLanguage } = language
    const replyLocalFrame =
      (await dependencies.replyVoices?.resolveLocalFrame({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        languageGroup: concreteReplyLanguage.templateGroup,
      })) ?? null
    const grant = await resolveDraftingGrant(dependencies, input)
    if (grant.kind === 'refused') return grant.result
    const { authorization, profile, brandProfile, stopFence } = grant
    const nowEpochMillis = dependencies.nowEpochMillis()

    // V2 admits before reserving a frame or claiming an operation, so refused
    // and busy requests leave no generation records.
    const admission = v2
      ? await admitReplyDraft(dependencies, input, nowEpochMillis)
      : null
    if (admission && !admission.ok) {
      return admission.code === 'admission_busy'
        ? unavailable('busy', admission.retryAfterEpochMillis)
        : unavailable('provider_unavailable', nowEpochMillis + 5_000)
    }
    let releaseAdmission = admission
      ? releaseReplyAdmissionOnce(dependencies.admission, admission.admissionId)
      : async () => {}
    try {
      const generationSeed = replyDraftingV2GenerationSeed(input)
      const replyV2Frame = v2
        ? await dependencies.replyVoices?.resolveV2Frame?.({
            ...input,
            languageGroup: concreteReplyLanguage.templateGroup,
            generationSeed,
            nowEpochMillis: dependencies.nowEpochMillis(),
          })
        : undefined
      if (v2 && !replyV2Frame) return unavailable('policy_unavailable')
      reportReplyReading(input, v2, replyV2Frame?.candidates[0], reviewText)
      const canonicalSource = encodeCanonicalAiReviewSource({
        text: reviewText,
        rating: observation.rating,
        languageCode: observation.languageCode,
        reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
      })
      const sourceProvenance = aiReviewSourceProvenance(canonicalSource.bytes)
      canonicalSource.bytes.fill(0)
      const replyDraftingEpoch = authorization.capabilityEpochs.reply_drafting.epoch
      const currentnessFence = {
        authorizationLineageId: authorization.authorizationLineageId,
        replyDraftingEpoch,
        baseReplyStateRevision,
        replyBrandProfileVersion: brandProfile.version,
        replyBrandDisplayName: brandProfile.displayName,
        replyBrandDisplayNameDigest: brandProfile.displayNameDigest,
        voiceDigest: replyV2Frame?.voiceDigest ?? replyLocalFrame?.voiceDigest ?? null,
        ...(v2
          ? {
              authorizationStateVersion: authorization.stateVersion,
              noticeVersion: authorization.noticeVersion,
              noticeDigest: authorization.noticeDigest,
            }
          : {}),
        languageGroup: concreteReplyLanguage.templateGroup,
      }
      const identity = replyOperationIdentity(
        input,
        observation.reviewedAtEpochMillis,
        baseReplyStateRevision,
      )
      const baseBinding = replyExecutionBinding({
        input,
        authorization,
        authorizationLineageId: authorization.authorizationLineageId,
        operationProfile,
        evaluatedLanguage: language.evaluatedLanguage.group,
        concreteReplyLanguage,
        reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
        profile,
        brandProfile,
        replyDraftingEpoch,
        baseReplyStateRevision,
        stopFence,
      })
      const binding = bindReplyDraftingV2(baseBinding, {
        attempt: v2,
        input,
        languageCode: concreteReplyLanguage.tag,
        generationSeed,
        voiceDigest: replyV2Frame?.voiceDigest ?? null,
      })
      const requestFingerprint = aiRequestFingerprint({
        identity,
        binding,
        sourceProvenance,
      })
      publishReplyDraftingIdentity(input, requestFingerprint, async () =>
        isReplyDraftingIdentityCurrent(
          dependencies,
          input,
          concreteReplyLanguage.tag,
          profile.profileVersion,
          () => isReplySuggestionStillCurrent(dependencies, input, currentnessFence),
          { language: resolveSuggestionLanguage, grant: resolveDraftingGrant },
        ),
      )
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
      if (hasProducedDraft(claimed.operation.state)) {
        return unavailable('completed_without_delivery')
      }
      const expectedAttempt = claimed.operation.executionAttempt + 1
      if (expectedAttempt > 4) return unavailable('provider_unavailable')
      // Preserve v1's claim-before-admission order for replay and conflict handling.
      if (!admission) {
        const v1Admission = await admitInteractiveDraft(
          dependencies,
          input,
          nowEpochMillis,
        )
        if (!v1Admission.ok)
          return v1Admission.code === 'admission_busy'
            ? unavailable('busy', v1Admission.retryAfterEpochMillis)
            : unavailable('provider_unavailable', nowEpochMillis + 5_000)
        releaseAdmission = releaseReplyAdmissionOnce(
          dependencies.admission,
          v1Admission.admissionId,
        )
      }
      const admittedAtEpochMillis = Math.max(
        nowEpochMillis,
        dependencies.nowEpochMillis(),
      )
      const execution = await dependencies.operations.claimExecution({
        operationId: claimed.operation.id,
        organizationId: input.organizationId,
        expectedAttempt,
        nowEpochMillis: admittedAtEpochMillis,
      })
      if (execution === null || execution.executionPermitId === null) {
        return unavailable('provider_unavailable', admittedAtEpochMillis + 1_000)
      }
      if (
        v2 &&
        (await isReplySuggestionStillCurrent(dependencies, input, currentnessFence)) !==
          'current'
      )
        return unavailable('source_changed')
      if (
        v2?.logicalDeadlineEpochMillis !== undefined &&
        dependencies.nowEpochMillis() + operationProfile.requestDeadlineMs >
          v2.logicalDeadlineEpochMillis
      )
        return unavailable('provider_unavailable')
      const response = await dependencies.inference.generateReply(
        {
          route: 'reply-suggestion',
          replyProfileVersion: v2
            ? REPLY_DRAFTING_V2_VERSIONS.profile
            : AI_PERSONALIZED_REPLY_PROFILE_VERSION,
          brandProfile: { displayName: brandProfile.displayName },
          ...(v2 ? { replyV2Frame: replyV2Frame! } : { replyLocalFrame }),
          operationId: execution.id,
          permitId: execution.executionPermitId,
          attemptNumber: expectedAttempt,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          internalSubjectId: input.reviewId,
          actorId: input.actorUserId,
          binding,
          deadlineEpochMillis: admittedAtEpochMillis + operationProfile.requestDeadlineMs,
          redactionCountry: profile.countryCode,
          observedContentExpiresAtEpochMillis: observation.contentExpiresAtEpochMillis,
          tone: input.tone,
          source: {
            kind: 'review',
            text: reviewText,
            rating: observation.rating,
            languageCode: observation.languageCode,
            reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
            ...(v2 ? { sentences: [...(observation.sentences ?? [])] } : {}),
          },
        },
        AbortSignal.timeout(operationProfile.requestDeadlineMs),
        ...replyProgressArguments(v2, input),
      )
      if (response.status === 'error') {
        const retryAtEpochMillis = await recordReplyProviderFailure(dependencies, {
          operationId: execution.id,
          organizationId: input.organizationId,
          expectedAttempt,
          failureCode: response.code,
          providerRetryAfterEpochMillis: response.retryAfterEpochMillis,
        })
        // Never substitute a template here. A manager who asked for a
        // personalized draft is told it could not be written; using the
        // governed template is their explicit choice (`templateOnly`).
        return await rewriteReplyDraftingV2({
          attempt: v2
            ? {
                ...v2,
                logicalDeadlineEpochMillis:
                  v2.logicalDeadlineEpochMillis ?? admittedAtEpochMillis + 150_000,
              }
            : undefined,
          operationId: execution.id,
          issues: response.code === 'output_invalid' ? response.rewriteIssues : undefined,
          nowEpochMillis: dependencies.nowEpochMillis(),
          release: releaseAdmission,
          recheck: async () =>
            (await isReplySuggestionStillCurrent(
              dependencies,
              input,
              currentnessFence,
            )) === 'current',
          execute: (child, idempotencyKey) =>
            createGenerateReplySuggestion(
              dependencies,
              child,
            )({
              ...input,
              idempotencyKey,
              variation: binding.replyDraftingV2?.options.variation,
            }),
          refused: unavailable('provider_unavailable', retryAtEpochMillis),
        })
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
        operationProfileVersion: v2
          ? REPLY_DRAFTING_V2_VERSIONS.operation
          : REPLY_OPERATION_PROFILE_VERSION,
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
      if (v2) {
        const finalCurrentness = await isReplySuggestionStillCurrent(
          dependencies,
          input,
          currentnessFence,
        )
        if (finalCurrentness !== 'current') return unavailable(finalCurrentness)
      }
      const delivered = await dependencies.operations.markDelivered({
        operationId: execution.id,
        organizationId: input.organizationId,
        expectedAttempt,
        deliveredAtEpochMillis: dependencies.nowEpochMillis(),
      })
      if (v2 && !delivered) return unavailable('completed_without_delivery')
      return {
        status: 'ready',
        profileVersion: response.result.profileVersion,
        ...(response.result.profileVersion === REPLY_DRAFTING_V2_VERSIONS.profile
          ? { mainPoint: response.result.mainPoint, case: response.result.case }
          : {}),
        ...deliveredReplyFrame(replyV2Frame, response.result.replyText),
        replyText: response.result.replyText,
        provenanceToken: response.result.provenanceToken,
        expiresAtEpochMillis: response.result.expiresAtEpochMillis,
        baseReplyStateRevision,
        concreteLanguageTag: concreteReplyLanguage.tag,
      }
    } finally {
      await releaseAdmission()
    }
  })
  return generate
}
