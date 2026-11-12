import type { AiReplyOutputRefusal } from './reply-output-refusal'
import { prepareReplyDraftingV2 } from './reply-drafting-v2'
import { replyDynamicDeveloperBytes } from '#/shared/reply-drafting-v2-request'
import type { KeyObject } from 'node:crypto'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  mapReviewLanguageMetadata,
  type EvaluatedReviewLanguage,
} from '#/shared/ai-review-language-catalogue'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from '#/shared/ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from '#/shared/ai-structured-marker-detectors'
import type { ReplyLanguageDetector } from '#/shared/ai-reply-language-verifier'
import { REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA } from '#/shared/review-analysis-v3'
import { maximumCostMicrosWith } from '#/shared/ai-provider-pricing'
import type { AiOperationProviderPairing } from '#/shared/ai-provider-attestations'
import {
  AI_OPERATION_PROFILES,
  type AiOperationProfile,
} from '#/shared/ai-operation-profiles'
import type {
  AiAdmissionDescriptorV1,
  AiSettlementReceiptV1,
} from '#/shared/ai-internal-transport-contract'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type {
  AiGatewayRouteRequestV1,
  AiGatewayRouteResponseV1,
} from '#/shared/ai-gateway-transport-contract'
import {
  GatewayPreparationError,
  type AiGatewayRoutePreparer,
  type PreparedGatewayRouteExecution,
} from './contracts'
import type { DerivedDescriptorFacts } from './prepared-invocation'
import { createOpenAiProviderPreparation } from './openai-provider-adapter'
import type { AiProviderId, AiProviderPreparation } from './provider-contracts'
import {
  AiProviderSelectionError,
  createAiProviderRegistry,
  selectAiProvider,
  type AiProviderRegistry,
} from './provider-selection'
import { derivePropertySafetyIdentifier } from './safety-identifier'
import {
  acceptReviewAnalysisV3Answer,
  isReviewAnalysisV3Operation,
  prepareReviewEvidence,
} from './review-evidence-request'

/**
 * What the preparer reads of an operation profile. The live catalogue holds the
 * v2 profiles only; a profile for review-analysis v3 is handed in by a test or,
 * at activation, by the catalogue, and never found by accident.
 */
export type RoutePreparationProfile = Omit<
  AiOperationProfile,
  'profileVersion' | 'providerDeploymentProfileVersion'
> &
  Readonly<{
    profileVersion: string
    providerDeploymentProfileVersion: string
    /**
     * The providers the profile is attested for (contract section 7.1). Absent
     * means OpenAI alone, which is what every profile in the live catalogue is.
     */
    attestedProviders?: readonly AiProviderId[]
    /**
     * What each attested provider reserves before the first payload byte. A
     * provider with no pairing is priced from the profile's own OpenAI-shaped
     * `staticTokenBearingBytes`, which only OpenAI may be.
     */
    pairings?: Readonly<Partial<Record<AiProviderId, AiOperationProviderPairing>>>
  }>

/** The profile a request names: its route and its operation profile version. */
function profileFor(
  profiles: readonly RoutePreparationProfile[],
  request: AiGatewayRouteRequestV1,
): RoutePreparationProfile {
  const profile = profiles.find(
    (candidate) =>
      candidate.sourceRoute === request.route &&
      candidate.profileVersion === request.binding.operationProfileVersion,
  )
  if (!profile || profile.sourceRoute === 'synthetic-canary')
    throw new GatewayPreparationError('policy_unavailable')
  return profile
}

/** What an operation may cost, priced by the provider that will serve it. */
function reservationMicros(
  profile: RoutePreparationProfile,
  provider: Pick<AiProviderPreparation, 'providerId' | 'pricing'>,
  providerPayloadBytes: number,
): number {
  try {
    return maximumCostMicrosWith(
      provider.pricing,
      {
        staticTokenBearingBytes:
          profile.pairings?.[provider.providerId]?.staticTokenBearing.bytes ??
          profile.staticTokenBearingBytes +
            replyDynamicDeveloperBytes(profile.profileVersion),
        maxOutputTokens: profile.maxOutputTokens,
      },
      providerPayloadBytes,
    )
  } catch {
    throw new GatewayPreparationError('policy_unavailable')
  }
}

/**
 * The adapter that serves a profile: the provider the operator chose, or the one
 * provider the profile is attested for. A refusal is final for this call. It is
 * never answered by another provider (`provider-selection.ts`).
 */
function providerFor(
  registry: AiProviderRegistry<AiProviderPreparation>,
  profile: RoutePreparationProfile,
): AiProviderPreparation {
  try {
    return selectAiProvider(registry, {
      capability: profile.capability,
      eligible: profile.attestedProviders ?? ['openai'],
    })
  } catch (error) {
    if (error instanceof AiProviderSelectionError) {
      throw new GatewayPreparationError(
        error.code === 'selected_not_ready'
          ? 'provider_unavailable'
          : 'policy_unavailable',
      )
    }
    throw error
  }
}

/**
 * A request that names the provider it was claimed under is served only by that
 * provider as it is attested now. Another provider, or the same one re-attested,
 * means the operator switched since the claim, and the operation does not follow
 * the switch: it ends and a new one is claimed (contract section 7.3).
 */
function assertClaimedProvider(
  request: AiGatewayRouteRequestV1,
  profile: RoutePreparationProfile,
  provider: AiProviderPreparation,
): void {
  const claimed = request.route === 'review-analysis' ? request.provider : undefined
  if (claimed === undefined) {
    if ((profile.attestedProviders?.length ?? 1) > 1) {
      throw new GatewayPreparationError('invalid_request')
    }
    return
  }
  if (
    claimed.id !== provider.providerId ||
    claimed.model !== provider.requestProfile.model ||
    claimed.requestProfileVersion !== provider.requestProfile.version ||
    claimed.requestProfileDigest !== provider.requestProfile.digest
  ) {
    throw new GatewayPreparationError('provider_profile_changed')
  }
}

function createDescriptor(
  request: AiGatewayRouteRequestV1,
  profile: RoutePreparationProfile,
  facts: DerivedDescriptorFacts,
  costMicros: number,
): AiAdmissionDescriptorV1 {
  const common = {
    version: 'ai-admission-descriptor-v1' as const,
    operationId: request.operationId,
    permitId: request.permitId,
    attemptNumber: request.attemptNumber,
    ...facts,
    limits: {
      sourceBytes: profile.sourceByteLimit,
      providerPayloadBytes: profile.providerPayloadByteLimit,
      preparedRequestBytes: profile.preparedRequestByteLimit,
      responseBytes: profile.responseByteLimit,
      outputTokens: profile.maxOutputTokens,
      costMicros,
    },
    callerDeadlineEpochMillis: request.deadlineEpochMillis,
    subjectKind: 'property' as const,
    organizationId: request.organizationId,
    propertyId: request.propertyId,
    internalSubjectId: request.internalSubjectId,
    binding: request.binding,
    canaryBinding: null,
    releaseSha: null,
    canaryAuthorizationId: null,
    redactionProfileVersion: request.binding.redactionProfileVersion,
    outputLeakageProfileVersion: request.binding.outputLeakageProfileVersion,
    outputLeakageProfileDigest: request.binding.outputLeakageProfileDigest,
    replyTemplateCatalogueVersion: request.binding.replyTemplateCatalogueVersion,
    replyTemplateCatalogueDigest: request.binding.replyTemplateCatalogueDigest,
  }

  if (request.route === 'review-analysis')
    return {
      ...common,
      route: 'review-analysis',
      actorId: null,
      observedContentExpiresAtEpochMillis: request.observedContentExpiresAtEpochMillis,
      redactionCountry: request.redactionCountry,
    }
  return {
    ...common,
    route: 'reply-suggestion',
    actorId: request.actorId,
    observedContentExpiresAtEpochMillis: request.observedContentExpiresAtEpochMillis,
    redactionCountry: request.redactionCountry,
  }
}

function languageFor(
  request: Extract<
    AiGatewayRouteRequestV1,
    { route: 'review-analysis' | 'reply-suggestion' }
  >,
): EvaluatedReviewLanguage {
  const mapped = mapReviewLanguageMetadata(request.source.languageCode)
  if (mapped.status === 'language_not_supported')
    throw new GatewayPreparationError('language_not_supported')
  if (mapped.status !== 'supported')
    throw new GatewayPreparationError('policy_unavailable')
  if (
    request.binding.languageCatalogueDigest !== LANGUAGE_CATALOGUE_DIGEST ||
    request.binding.evaluatedLanguage !== mapped.language.group
  )
    throw new GatewayPreparationError('policy_unavailable')
  return mapped.language
}

function redactedText(
  request: Extract<
    AiGatewayRouteRequestV1,
    { route: 'review-analysis' | 'reply-suggestion' }
  >,
): string {
  if (request.source.text === null || request.source.text.length === 0)
    throw new GatewayPreparationError('text_unavailable')
  if (request.binding.redactionProfileVersion !== AI_REDACTION_PROFILE_VERSION)
    throw new GatewayPreparationError('policy_unavailable')
  const redaction = redactAiReviewText({
    text: request.source.text,
    countryCode: request.redactionCountry,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
  if (redaction.status !== 'redacted')
    throw new GatewayPreparationError('redaction_blocked')
  return redaction.text
}

function reviewSourceBytes(
  request: Extract<
    AiGatewayRouteRequestV1,
    { route: 'review-analysis' | 'reply-suggestion' }
  >,
): Uint8Array {
  return encodeCanonicalAiReviewSource({
    text: request.source.text,
    rating: request.source.rating,
    languageCode: request.source.languageCode,
    reviewedAtEpochMillis: request.source.reviewedAtEpochMillis,
  }).bytes
}

export type { AiReplyOutputRefusal } from './reply-output-refusal'

export function createAiGatewayRoutePreparer(
  dependencies: Readonly<{
    requestBindingKeys: VersionedHmacKeyring
    safetyIdentifierKey: Uint8Array
    replyLanguageDetector: ReplyLanguageDetector
    provenanceKid: string
    provenancePrivateKey: KeyObject
    now?: () => number
    /** The operation profiles requests may name. Defaults to the live catalogue. */
    profiles?: readonly RoutePreparationProfile[]
    /**
     * The providers that can shape a request, and the operator's choice among
     * them. Defaults to OpenAI alone, which is every v2 route.
     */
    providers?: AiProviderRegistry<AiProviderPreparation>
    /**
     * Content-free notice of WHICH output rule refused a reply draft.
     *
     * Every refusal below lands on the operation as one opaque
     * `output_invalid`, which is undiagnosable after the fact: five different
     * rules produce it, the provider has already been billed, and the operator
     * is shown a local fallback. Attributing 11 real refusals on the beta
     * property required attaching a debugger-style probe to the running
     * process. The reason is a fixed identifier - never review or reply text -
     * so it is safe to record.
     */
    onOutputRefused?: (refusal: AiReplyOutputRefusal) => void
  }>,
): AiGatewayRoutePreparer {
  const now = dependencies.now ?? Date.now
  const profiles: readonly RoutePreparationProfile[] =
    dependencies.profiles ?? AI_OPERATION_PROFILES
  const registry =
    dependencies.providers ??
    createAiProviderRegistry([createOpenAiProviderPreparation()])
  return Object.freeze({
    prepare: (request): PreparedGatewayRouteExecution => {
      const profile = profileFor(profiles, request)
      assertPreparationProfile(request, profile)
      const provider = providerFor(registry, profile)
      assertClaimedProvider(request, profile, provider)
      const v2 = prepareReplyV2Route(request, profile, provider, dependencies, now)
      if (v2) return v2

      if (request.route !== 'review-analysis' || !isReviewAnalysisV3Operation(request))
        throw new GatewayPreparationError('policy_unavailable')

      const evaluated = languageFor(request)
      const evidence = prepareReviewEvidence(request, {
        languageTag: evaluated.tag,
        redactedWholeText: redactedText(request),
      })
      const providerPayload = evidence.providerPayload
      const responseContext = Object.freeze({
        redactedSentences: evidence.redactedSentences,
        vocabularyHints: evidence.vocabularyHints,
      })

      const safetyIdentifier = derivePropertySafetyIdentifier({
        kind: 'system',
        organizationId: request.organizationId,
        propertyId: request.propertyId,
        key: dependencies.safetyIdentifierKey,
      })
      const sourceBytes = reviewSourceBytes(request)
      let invocation
      try {
        invocation = provider.prepare({
          logical: {
            route: request.route,
            operationId: request.operationId,
            developerPrompt: profile.developerPrompt,
            outputSchemaName: profile.outputSchemaName,
            outputSchema: REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA,
            untrustedData: canonicalizeRfc8785(providerPayload),
            maxOutputTokens: profile.maxOutputTokens,
            reasoningEffort: profile.reasoningEffort,
            safetyIdentifier,
          },
          sourceBytes,
          providerPayload,
          createDescriptor: (facts) =>
            createDescriptor(
              request,
              profile,
              facts,
              reservationMicros(profile, provider, facts.providerPayloadByteCount),
            ),
          requestBindingKeys: dependencies.requestBindingKeys,
        })
      } finally {
        sourceBytes.fill(0)
      }
      return Object.freeze({
        providerId: provider.providerId,
        invocation,
        outputSchema: REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA,
        acceptProviderResult: (rawResult: unknown) => {
          const accepted = acceptReviewAnalysisV3Answer(rawResult, responseContext)
          if (accepted === null) return null
          return Object.freeze({
            buildResponse: (
              receipt: AiSettlementReceiptV1,
            ): AiGatewayRouteResponseV1 => ({
              route: 'review-analysis',
              status: 'success',
              result: accepted,
              settlementReceipt: receipt,
            }),
          })
        },
      })
    },
  })
}

function prepareReplyV2Route(
  request: AiGatewayRouteRequestV1,
  profile: RoutePreparationProfile,
  provider: AiProviderPreparation,
  dependencies: Parameters<typeof createAiGatewayRoutePreparer>[0],
  now: () => number,
): PreparedGatewayRouteExecution | null {
  if (
    request.route !== 'reply-suggestion' ||
    profile.profileVersion !== 'reply-suggestion-v2'
  )
    return null
  const sourceBytes = reviewSourceBytes(request)
  try {
    return prepareReplyDraftingV2(request, {
      ...dependencies,
      now,
      profile,
      provider,
      sourceBytes,
      text: redactedText(request),
      evaluated: languageFor(request),
      createDescriptor: (facts) =>
        createDescriptor(
          request,
          profile,
          facts,
          reservationMicros(profile, provider, facts.providerPayloadByteCount),
        ),
    })
  } finally {
    sourceBytes.fill(0)
  }
}

function assertPreparationProfile(
  request: AiGatewayRouteRequestV1,
  profile: RoutePreparationProfile,
): void {
  if (
    request.binding.operationProfileVersion !== profile.profileVersion ||
    request.binding.providerDeploymentProfileVersion !==
      profile.providerDeploymentProfileVersion ||
    request.binding.capabilityRuntimeProfileVersion !==
      profile.capabilityRuntimeProfileVersion
  )
    throw new GatewayPreparationError('policy_unavailable')
}
