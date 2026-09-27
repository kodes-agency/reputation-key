import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
} from '#/shared/ai-operation-profiles'
import {
  mapReviewLanguageMetadata,
  parseCanonicalReplyLanguageTag,
  type ConcreteReplyLanguage,
  type EvaluatedReviewLanguage,
} from '#/shared/ai-review-language-catalogue'
import type { ConcreteReplyLanguageResult } from '#/shared/ai-reply-language-verifier'
import {
  resolveAiReplyTemplate,
  type ReplyTone,
} from '#/shared/ai-reply-template-catalogue'
import {
  AI_PERSONALIZED_REPLY_LANGUAGES,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from '#/shared/ai-personalized-reply-contract'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type { AiInferencePort } from '../ports/ai-inference.port'
import type {
  AiOperationState,
  AiOperationStorePort,
} from '../ports/ai-operation-store.port'
import type { AiOutputStorePort } from '../ports/ai-output-store.port'
import type { AiAdmissionPort } from '../ports/ai-admission.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { AiOperationId } from '../../domain/types'
import type { AiErrorCode } from '../../domain/errors'
import {
  aiRequestFingerprint,
  aiRetryAt,
  aiReviewSourceProvenance,
  resolveAiExecutionStopFence,
} from '../ai-workflow-support'
import { replyExecutionBinding, replyOperationIdentity } from '../ai-operation-binding'

const REPLY_OPERATION_PROFILE_VERSION = 'reply-suggestion-v1' as const
/**
 * How long a draft request may wait for an interactive slot before answering
 * busy. Short enough that the manager is never left staring at a spinner, long
 * enough to absorb a slot that frees within the same request.
 */
const REPLY_ADMISSION_WAIT_MILLIS = 4_000
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
        // The manager explicitly asked for the governed catalogue template.
        | 'template_requested'
        // The target language has catalogue templates but no personalized
        // drafting profile, so a template is the only draft available.
        | 'language_not_personalized'
        | 'language_undetermined'
        | 'no_review_text'
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
        // Our own interactive AI capacity is in use; retry at the given time.
        | 'busy'
      retryAfterEpochMillis: number | null
    }>

export type GenerateReplySuggestionDependencies = Readonly<{
  authorization: AiAuthorizationPort
  control: AiControlPort
  inference: AiInferencePort
  operations: AiOperationStorePort
  outputs: AiOutputStorePort
  admission: AiAdmissionPort
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
  /** Injected for tests; defaults to a timer. */
  sleep?: (milliseconds: number) => Promise<void>
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

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

/**
 * Take an interactive slot, waiting up to REPLY_ADMISSION_WAIT_MILLIS when the
 * lane says one frees in time. A busy answer consumes nothing, so asking again
 * is free; a slot that frees later than the wait allows is reported as busy
 * with its retry time rather than waited for.
 */
async function admitInteractiveDraft(
  dependencies: Pick<
    GenerateReplySuggestionDependencies,
    'admission' | 'nowEpochMillis' | 'sleep'
  >,
  input: Pick<GenerateReplySuggestionInput, 'organizationId' | 'propertyId'>,
  startedAtEpochMillis: number,
) {
  const sleep = dependencies.sleep ?? defaultSleep
  const deadline = startedAtEpochMillis + REPLY_ADMISSION_WAIT_MILLIS
  let nowEpochMillis = startedAtEpochMillis
  for (;;) {
    const claim = await dependencies.admission.acquire({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      lane: 'interactive',
      nowEpochMillis,
    })
    if (claim.ok || claim.code !== 'admission_busy') return claim
    if (claim.retryAfterEpochMillis > deadline) return claim
    await sleep(Math.max(50, claim.retryAfterEpochMillis - nowEpochMillis))
    nowEpochMillis = Math.max(nowEpochMillis + 1, dependencies.nowEpochMillis())
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
  if (!PERSONALIZED_LANGUAGE_SET.has(target.language.templateGroup)) {
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
 * drafting on this runtime profile.
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
    authorization.capabilities.includes('reply_drafting') &&
    authorization.capabilityRuntimeProfileVersions.reply_drafting ===
      PROFILE.capabilityRuntimeProfileVersion
  )
}

/**
 * A claimed operation that already produced its draft. The draft is
 * session-ephemeral and never stored, so it cannot be delivered again.
 */
const hasProducedDraft = (state: AiOperationState): boolean =>
  state === 'succeeded' || state === 'succeeded_pending_delivery'

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
    const language = await resolveSuggestionLanguage(dependencies, input, observation)
    if (language.kind === 'settled') return language.result
    const { reviewText, concreteReplyLanguage } = language

    const [authorization, runtime, brandProfile] = await Promise.all([
      dependencies.authorization.readMerchantAuthorization(input),
      dependencies.processingProfiles.readForAi(input),
      dependencies.replyBrandProfiles.readCurrentAiReplyBrandProfile(
        input.organizationId,
        input.propertyId,
      ),
    ])
    if (
      !isReplyDraftingAuthorized(authorization, input) ||
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
    const identity = replyOperationIdentity(
      input,
      observation.reviewedAtEpochMillis,
      baseReplyStateRevision,
    )
    const binding = replyExecutionBinding({
      input,
      authorization,
      authorizationLineageId: authorization.authorizationLineageId,
      operationProfile: PROFILE,
      evaluatedLanguage: language.evaluatedLanguage.group,
      concreteReplyLanguage,
      reviewedAtEpochMillis: observation.reviewedAtEpochMillis,
      profile,
      brandProfile,
      replyDraftingEpoch,
      baseReplyStateRevision,
      stopFence,
    })
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
    if (hasProducedDraft(claimed.operation.state)) {
      return unavailable('completed_without_delivery')
    }
    const expectedAttempt = claimed.operation.executionAttempt + 1
    if (expectedAttempt > 4) return unavailable('provider_unavailable')
    // Admission comes before the execution claim: a busy lane is never an
    // attempt, and a manager's draft is admitted in the interactive lane, which
    // a review-analysis backlog cannot consume.
    const admission = await admitInteractiveDraft(dependencies, input, nowEpochMillis)
    if (!admission.ok) {
      return admission.code === 'admission_busy'
        ? unavailable('busy', admission.retryAfterEpochMillis)
        : unavailable('provider_unavailable', nowEpochMillis + 5_000)
    }
    try {
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
          deadlineEpochMillis: admittedAtEpochMillis + PROFILE.requestDeadlineMs,
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
        // Never substitute a template here. A manager who asked for a
        // personalized draft is told it could not be written; using the
        // governed template is their explicit choice (`templateOnly`).
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
        concreteLanguageTag: concreteReplyLanguage.tag,
      }
    } finally {
      await dependencies.admission.release({ admissionId: admission.admissionId })
    }
  }
}
