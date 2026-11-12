import { resolveSuggestionLanguage } from './language.server'
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
} from './requests.server'
import type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
  GenerateReplySuggestionDependencies,
} from '../application/reply-suggestion-contract'
export type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
  GenerateReplySuggestionDependencies,
} from '../application/reply-suggestion-contract'
import { REPLY_DRAFTING_V2_OPERATION_PROFILE } from '#/shared/reply/profile'
import { REPLY_DRAFTING_V2_VERSIONS } from '#/shared/reply-drafting-v2-schema'
import {
  bindReplyDraftingV2,
  replyDraftingV2GenerationSeed,
  selectedReplyDraftingAttempt,
  rewriteReplyDraftingV2,
  releaseReplyAdmissionOnce,
  type ReplyDraftingV2Attempt,
} from './workflow.server'
import type { OrganizationId } from '#/shared/domain/ids'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import {
  parseCanonicalReplyLanguageTag,
  type ReplyTemplateLanguageGroup,
} from '#/shared/ai-review-language-catalogue'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import type { AiAuthorizationPort } from '../application/ports/ai-authorization.port'
import type {
  AiExecutionStopFence,
  AiOperationId,
  AiPropertyProcessingProfile,
} from '../domain/types'
import type { AiErrorCode } from '../domain/errors'
import {
  AI_PROVIDER_CHARGED_CODES,
  aiRequestFingerprint,
  aiRetryAt,
  aiReviewSourceProvenance,
  isAiAuthorizationUnderServedContract,
  resolveAiExecutionStopFence,
} from '../application/ai-workflow-support'
import {
  replyExecutionBinding,
  replyOperationIdentity,
} from '../application/ai-operation-binding'

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

type MerchantAuthorization = NonNullable<
  Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>
>

type ReplyDraftingAuthorization = MerchantAuthorization &
  Readonly<{ authorizationLineageId: string }>

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
  const operationProfile = REPLY_DRAFTING_V2_OPERATION_PROFILE
  // fallow-ignore-next-line complexity -- fail-closed AI operation lifecycle must settle every claimed state in one boundary
  const generate = manageReplyDraftingRequests(dependencies, v2, async (input) => {
    const [source, baseReplyStateRevision] = await Promise.all([
      dependencies.reviewSources.readForAi({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        sentences: true,
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
    const language = await resolveSuggestionLanguage(dependencies, input, observation)
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
    const grant = await resolveDraftingGrant(dependencies, input)
    if (grant.kind === 'refused') return grant.result
    const { authorization, profile, brandProfile, stopFence } = grant
    const nowEpochMillis = dependencies.nowEpochMillis()

    // Admission comes before reserving a frame or claiming an operation, so refused
    // and busy requests leave no generation records.
    const admission = await admitReplyDraft(dependencies, input, nowEpochMillis)
    if (!admission.ok) {
      return admission.code === 'admission_busy'
        ? unavailable('busy', admission.retryAfterEpochMillis)
        : unavailable('provider_unavailable', nowEpochMillis + 5_000)
    }
    const releaseAdmission = releaseReplyAdmissionOnce(
      dependencies.admission,
      admission.admissionId,
    )
    try {
      const generationSeed = replyDraftingV2GenerationSeed(input)
      const replyV2Frame = await dependencies.replyVoices?.resolveV2Frame?.({
        ...input,
        languageGroup: concreteReplyLanguage.templateGroup,
        generationSeed,
        nowEpochMillis: dependencies.nowEpochMillis(),
      })
      if (!replyV2Frame) return unavailable('policy_unavailable')
      reportReplyReading(input, v2, replyV2Frame.candidates[0], reviewText)
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
        voiceDigest: replyV2Frame.voiceDigest,
        authorizationStateVersion: authorization.stateVersion,
        noticeVersion: authorization.noticeVersion,
        noticeDigest: authorization.noticeDigest,
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
        voiceDigest: replyV2Frame.voiceDigest,
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
        (await isReplySuggestionStillCurrent(dependencies, input, currentnessFence)) !==
        'current'
      )
        return unavailable('source_changed')
      if (
        v2.logicalDeadlineEpochMillis !== undefined &&
        dependencies.nowEpochMillis() + operationProfile.requestDeadlineMs >
          v2.logicalDeadlineEpochMillis
      )
        return unavailable('provider_unavailable')
      const response = await dependencies.inference.generateReply(
        {
          route: 'reply-suggestion',
          replyProfileVersion: REPLY_DRAFTING_V2_VERSIONS.profile,
          brandProfile: { displayName: brandProfile.displayName },
          replyV2Frame,
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
            sentences: [...(observation.sentences ?? [])],
          },
        },
        AbortSignal.timeout(operationProfile.requestDeadlineMs),
        ...replyProgressArguments(input),
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
          attempt: {
            ...v2,
            logicalDeadlineEpochMillis:
              v2.logicalDeadlineEpochMillis ?? admittedAtEpochMillis + 150_000,
          },
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
          isBusy: (result) => result.status === 'unavailable' && result.code === 'busy',
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
        operationProfileVersion: REPLY_DRAFTING_V2_VERSIONS.operation,
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
      const finalCurrentness = await isReplySuggestionStillCurrent(
        dependencies,
        input,
        currentnessFence,
      )
      if (finalCurrentness !== 'current') return unavailable(finalCurrentness)
      const delivered = await dependencies.operations.markDelivered({
        operationId: execution.id,
        organizationId: input.organizationId,
        expectedAttempt,
        deliveredAtEpochMillis: dependencies.nowEpochMillis(),
      })
      if (!delivered) return unavailable('completed_without_delivery')
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
