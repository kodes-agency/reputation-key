import type { KeyObject } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  mapReviewLanguageMetadata,
  parseCanonicalReplyLanguageTag,
  type ConcreteReplyLanguage,
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
import {
  AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
  resolveConcreteReplyLanguage,
  verifyReplyLanguageOutput,
  type ReplyLanguageDetector,
} from '#/shared/ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
} from '#/shared/ai-reply-template-catalogue'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import {
  CLOSED_TREND_SIGNAL_IDS,
  validateTrendSelection,
  type ClosedTrendSignalId,
  type DeterministicTrendCandidate,
} from '#/shared/ai-property-trend-contract'
import {
  AI_ANALYSIS_V2_OUTPUT_SCHEMA,
  AI_ANALYSIS_V2_PROVIDER_ANSWER_SCHEMA,
  AI_PERSONALIZED_REPLY_OUTPUT_SCHEMA,
  AI_TREND_SELECTION_OUTPUT_SCHEMA,
  mergeAiAnalysisV2Duplicates,
} from '#/shared/ai-route-output-schemas'
import { REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA } from '#/shared/review-analysis-v3'
import {
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
  parsePersonalizedReplyDraft,
} from '#/shared/ai-personalized-reply-contract'
import { AI_PROVIDER_DEPLOYMENT_PROFILE_V1 } from '#/shared/ai-openai-provider-profile'
import { maximumCostMicrosWith } from '#/shared/ai-provider-pricing'
import type { AiOperationProviderPairing } from '#/shared/ai-provider-attestations'
import {
  AI_OPERATION_PROFILES,
  type AiOperationProfile,
} from '#/shared/ai-operation-profiles'
import type {
  AiAdmissionDescriptorV1,
  AiExecutionGrantV1,
  AiSettlementReceiptV1,
} from '#/shared/ai-internal-transport-contract'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type {
  AiGatewayRouteRequestV1,
  AiGatewayRouteResponseV1,
} from '#/shared/ai-gateway-transport-contract'
import {
  GatewayPreparationError,
  OPENAI_PROMPT_VERSIONS,
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
  type PreparedReviewEvidence,
} from './review-evidence-request'
import { digestRenderedReply, signAiReplyProvenance } from '#/shared/ai-reply-provenance'
import { replyCommentProblem } from '#/shared/google-provider-control/reply-comment'
import { digestAiReplyBrandDisplayName } from '#/shared/ai-reply-brand-profile.server'
const analysisAnswerSchema = AI_ANALYSIS_V2_PROVIDER_ANSWER_SCHEMA
const personalizedReplySchema = AI_PERSONALIZED_REPLY_OUTPUT_SCHEMA
const trendSelectionSchema = AI_TREND_SELECTION_OUTPUT_SCHEMA
const CLOSED_TREND_SIGNAL_ID_SET: ReadonlySet<string> = new Set<string>(
  CLOSED_TREND_SIGNAL_IDS,
)

function isClosedTrendSignalId(value: string): value is ClosedTrendSignalId {
  return CLOSED_TREND_SIGNAL_ID_SET.has(value)
}

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
          profile.staticTokenBearingBytes,
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
  if (request.route === 'property-trend')
    return {
      ...common,
      route: 'property-trend',
      actorId: null,
      observedContentExpiresAtEpochMillis: null,
      redactionCountry: null,
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

/** Which reply-output rule refused. Identifiers only, no provider content. */
export type AiReplyOutputRefusal = Readonly<{
  route: 'reply-suggestion'
  reason:
    | 'shape'
    | 'language'
    | 'grounding'
    | 'brand'
    | 'prohibited_content'
    | 'profile_version_mismatch'
    | 'language_verification'
    | 'reply_limits'
    | 'adoption_window_elapsed'
}>

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
      if (
        request.binding.operationProfileVersion !== profile.profileVersion ||
        request.binding.providerDeploymentProfileVersion !==
          profile.providerDeploymentProfileVersion ||
        request.binding.capabilityRuntimeProfileVersion !==
          profile.capabilityRuntimeProfileVersion
      )
        throw new GatewayPreparationError('policy_unavailable')
      const provider = providerFor(registry, profile)
      assertClaimedProvider(request, profile, provider)

      let providerPayload: Readonly<Record<string, unknown>>
      let outputSchema: z.ZodTypeAny
      let responseContext:
        | Readonly<{ route: 'review-analysis' }>
        | (Readonly<{ route: 'review-analysis-v3' }> &
            Pick<PreparedReviewEvidence, 'redactedSentences' | 'vocabularyHints'>)
        | Readonly<{
            route: 'property-trend'
            candidates: readonly DeterministicTrendCandidate[]
          }>
        | Readonly<{
            route: 'reply-suggestion'
            operationId: string
            actorId: string
            organizationId: string
            propertyId: string
            reviewId: string
            redactionCountry: string
            tone: 'professional' | 'friendly' | 'casual'
            sourceEpoch: number
            sourceRevision: number
            baseReplyStateRevision: number
            replyDraftingEpoch: number
            propertyProfileVersion: number
            replyBrandProfileVersion: number
            replyBrandDisplayNameDigest: string
            brandDisplayName: string
            replyLocalFrame: Extract<
              AiGatewayRouteRequestV1,
              { route: 'reply-suggestion' }
            >['replyLocalFrame']
            providerDeploymentProfileVersion: typeof AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion
            operationProfileVersion: 'reply-suggestion-v1'
            modelSnapshot: typeof AI_PROVIDER_DEPLOYMENT_PROFILE_V1.modelSnapshot
            promptVersion: (typeof OPENAI_PROMPT_VERSIONS)['reply-suggestion']
            replyProfileVersion: typeof AI_PERSONALIZED_REPLY_PROFILE_VERSION
            concreteLanguage: ConcreteReplyLanguage
            redactedReviewText: string
            rating: 1 | 2 | 3 | 4 | 5
          }>
      if (request.route === 'property-trend') {
        const detachedTrendPayload = structuredClone(request.source)
        const trendCandidates = Object.freeze(
          detachedTrendPayload.candidates.map((candidate) =>
            Object.freeze({ ...candidate }),
          ),
        )
        providerPayload = detachedTrendPayload
        outputSchema = trendSelectionSchema
        responseContext = Object.freeze({
          route: 'property-trend',
          candidates: trendCandidates,
        })
      } else {
        const evaluated = languageFor(request)
        const text = redactedText(request)
        if (request.route === 'review-analysis' && isReviewAnalysisV3Operation(request)) {
          const evidence = prepareReviewEvidence(request, {
            languageTag: evaluated.tag,
            redactedWholeText: text,
          })
          providerPayload = evidence.providerPayload
          outputSchema = REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA
          responseContext = Object.freeze({
            route: 'review-analysis-v3',
            redactedSentences: evidence.redactedSentences,
            vocabularyHints: evidence.vocabularyHints,
          })
        } else if (request.route === 'review-analysis') {
          providerPayload = {
            reviewText: text,
            rating: request.source.rating,
            languageCode: evaluated.tag,
          }
          outputSchema = analysisAnswerSchema
          responseContext = Object.freeze({ route: 'review-analysis' })
        } else {
          if (
            request.binding.replyLanguageVerifierDigest !==
              AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST ||
            request.binding.languageScriptConsistencyDigest !==
              AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST ||
            request.binding.zhOrthographyVerifierDigest !==
              AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST
          )
            throw new GatewayPreparationError('policy_unavailable')
          const resolved = resolveConcreteReplyLanguage({
            text,
            evaluatedLanguage: evaluated,
            detector: dependencies.replyLanguageDetector,
          })
          if (resolved.status === 'language_not_supported') {
            throw new GatewayPreparationError('language_not_supported')
          }
          if (resolved.status !== 'resolved') {
            throw new GatewayPreparationError('policy_unavailable')
          }
          // Source language and reply target are separate governed facts. The
          // source still passes the pinned detector + metadata consistency
          // check above, while the target is the canonical language admitted
          // in the operation binding by the tenant-scoped application use case.
          const admittedTarget = request.binding.concreteReplyLanguage
          const concrete =
            admittedTarget === null
              ? null
              : parseCanonicalReplyLanguageTag(admittedTarget.tag)
          if (
            concrete === null ||
            concrete.templateGroup !== admittedTarget?.templateGroup
          )
            throw new GatewayPreparationError('policy_unavailable')
          if (
            request.binding.replyTemplateCatalogueVersion !==
              AI_REPLY_TEMPLATE_CATALOGUE_VERSION ||
            request.binding.replyTemplateCatalogueDigest !==
              AI_REPLY_TEMPLATE_CATALOGUE_DIGEST ||
            request.binding.outputLeakageProfileVersion !==
              AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION ||
            request.binding.outputLeakageProfileDigest !==
              AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST
          )
            throw new GatewayPreparationError('policy_unavailable')
          if (
            profile.profileVersion !== 'reply-suggestion-v1' ||
            profile.providerDeploymentProfileVersion !==
              AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion
          ) {
            throw new GatewayPreparationError('policy_unavailable')
          }
          const fence = request.binding.capabilityFence
          if (
            fence.capability !== 'reply_drafting' ||
            request.binding.sourceRevision === null ||
            request.binding.replyBrandProfileVersion === null ||
            request.binding.replyBrandProfileVersion === undefined ||
            request.binding.replyBrandDisplayNameDigest === null ||
            request.binding.replyBrandDisplayNameDigest === undefined ||
            digestAiReplyBrandDisplayName(request.brandProfile.displayName) !==
              request.binding.replyBrandDisplayNameDigest
          )
            throw new GatewayPreparationError('policy_unavailable')
          providerPayload = {
            replyProfileVersion: request.replyProfileVersion,
            reviewText: text,
            rating: request.source.rating,
            languageCode: concrete.tag,
            tone: request.tone,
          }
          outputSchema = personalizedReplySchema
          responseContext = Object.freeze({
            route: 'reply-suggestion',
            operationId: request.operationId,
            actorId: request.actorId,
            organizationId: request.organizationId,
            propertyId: request.propertyId,
            reviewId: request.internalSubjectId,
            redactionCountry: request.redactionCountry,
            tone: request.tone,
            sourceEpoch: request.binding.sourceEpoch,
            sourceRevision: request.binding.sourceRevision,
            baseReplyStateRevision: fence.baseReplyStateRevision,
            replyDraftingEpoch: fence.replyDraftingEpoch,
            propertyProfileVersion: request.binding.propertyProfileVersion,
            replyBrandProfileVersion: request.binding.replyBrandProfileVersion,
            replyBrandDisplayNameDigest: request.binding.replyBrandDisplayNameDigest,
            brandDisplayName: request.brandProfile.displayName,
            replyLocalFrame: request.replyLocalFrame,
            providerDeploymentProfileVersion: profile.providerDeploymentProfileVersion,
            operationProfileVersion: profile.profileVersion,
            modelSnapshot: AI_PROVIDER_DEPLOYMENT_PROFILE_V1.modelSnapshot,
            promptVersion: OPENAI_PROMPT_VERSIONS['reply-suggestion'],
            replyProfileVersion: request.replyProfileVersion,
            concreteLanguage: concrete,
            redactedReviewText: text,
            rating: request.source.rating,
          })
        }
      }
      const safetyIdentifier = derivePropertySafetyIdentifier(
        request.route === 'reply-suggestion'
          ? {
              kind: 'interactive',
              organizationId: request.organizationId,
              propertyId: request.propertyId,
              actorId: request.actorId,
              key: dependencies.safetyIdentifierKey,
            }
          : {
              kind: 'system',
              organizationId: request.organizationId,
              propertyId: request.propertyId,
              key: dependencies.safetyIdentifierKey,
            },
      )
      const sourceBytes =
        request.route === 'property-trend'
          ? Buffer.from(`\u0002${canonicalizeRfc8785(request.source)}`, 'utf8')
          : reviewSourceBytes(request)
      let invocation
      try {
        invocation = provider.prepare({
          logical: {
            route: request.route,
            operationId: request.operationId,
            developerPrompt: profile.developerPrompt,
            outputSchemaName: profile.outputSchemaName,
            outputSchema,
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
        outputSchema,
        // fallow-ignore-next-line complexity -- exhaustive provider-result validation preserves one fail-closed acceptance boundary
        acceptProviderResult: (rawResult: unknown) => {
          if (responseContext.route === 'review-analysis-v3') {
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
          }
          if (responseContext.route === 'review-analysis') {
            const answer = analysisAnswerSchema.safeParse(rawResult)
            if (!answer.success) return null
            const result = AI_ANALYSIS_V2_OUTPUT_SCHEMA.safeParse(
              mergeAiAnalysisV2Duplicates(answer.data),
            )
            if (!result.success) return null
            const accepted = Object.freeze({ ...result.data })
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
          }
          if (responseContext.route === 'property-trend') {
            const result = trendSelectionSchema.safeParse(rawResult)
            if (!result.success) return null
            let selected
            if (!result.data.selectedSignalIds.every(isClosedTrendSignalId)) return null
            try {
              selected = validateTrendSelection({
                selectedSignalIds: result.data.selectedSignalIds,
                candidates: responseContext.candidates,
              })
            } catch {
              return null
            }
            return Object.freeze({
              buildResponse: (
                receipt: AiSettlementReceiptV1,
              ): AiGatewayRouteResponseV1 => ({
                route: 'property-trend',
                status: 'success',
                result: { selectedSignalIds: [...selected] },
                settlementReceipt: receipt,
              }),
            })
          }
          const result = parsePersonalizedReplyDraft({
            reviewText: responseContext.redactedReviewText,
            rating: responseContext.rating,
            targetLanguageTag: responseContext.concreteLanguage.tag,
            tone: responseContext.tone,
            countryCode: responseContext.redactionCountry,
            brandDisplayName: responseContext.brandDisplayName,
            output: rawResult,
          })
          if (
            result.status !== 'accepted' ||
            result.profileVersion !== responseContext.replyProfileVersion
          ) {
            dependencies.onOutputRefused?.({
              route: 'reply-suggestion',
              reason:
                result.status === 'accepted' ? 'profile_version_mismatch' : result.reason,
            })
            return null
          }
          const bodyText = result.draft.replyText
          const frame = responseContext.replyLocalFrame
          const replyText = frame
            ? [frame.prefix.trim(), bodyText.trim(), frame.suffix.trim()]
                .filter(Boolean)
                .join('\n\n')
            : bodyText
          if (replyCommentProblem(replyText) !== null) {
            dependencies.onOutputRefused?.({
              route: 'reply-suggestion',
              reason: 'reply_limits',
            })
            return null
          }
          if (
            verifyReplyLanguageOutput(
              replyText,
              responseContext.concreteLanguage,
              dependencies.replyLanguageDetector,
              [
                responseContext.brandDisplayName,
                frame?.reviewerDisplayName ?? '',
                frame?.contact ?? '',
                frame?.signerName ?? '',
                frame?.signerTitle ?? '',
                frame?.businessName ?? '',
              ].filter((span) => span.length >= 3),
            ).status !== 'valid'
          ) {
            dependencies.onOutputRefused?.({
              route: 'reply-suggestion',
              reason: 'language_verification',
            })
            return null
          }
          const renderDigest = digestRenderedReply(replyText)
          return Object.freeze({
            buildResponse: (
              receipt: AiSettlementReceiptV1,
              grant: AiExecutionGrantV1,
            ): AiGatewayRouteResponseV1 => {
              if (
                grant.replyTokenExpiresAtEpochMillis === null ||
                grant.replyDraftExpiresAtEpochMillis === null ||
                grant.replyTokenExpiresAtEpochMillis <= now()
              ) {
                dependencies.onOutputRefused?.({
                  route: 'reply-suggestion',
                  reason: 'adoption_window_elapsed',
                })
                throw new GatewayPreparationError('output_invalid')
              }
              const provenanceToken = signAiReplyProvenance(
                {
                  version: 'ai-reply-provenance-v3',
                  kid: dependencies.provenanceKid,
                  operationId: responseContext.operationId,
                  actorId: responseContext.actorId,
                  organizationId: responseContext.organizationId,
                  propertyId: responseContext.propertyId,
                  reviewId: responseContext.reviewId,
                  requestBindingHmac: grant.requestBindingHmac,
                  sourceEpoch: responseContext.sourceEpoch,
                  sourceRevision: responseContext.sourceRevision,
                  baseReplyStateRevision: responseContext.baseReplyStateRevision,
                  replyDraftingEpoch: responseContext.replyDraftingEpoch,
                  propertyProfileVersion: responseContext.propertyProfileVersion,
                  providerDeploymentProfileVersion:
                    responseContext.providerDeploymentProfileVersion,
                  operationProfileVersion: responseContext.operationProfileVersion,
                  replyProfileVersion: responseContext.replyProfileVersion,
                  replyProfileDigest: AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
                  replyBrandProfileVersion: responseContext.replyBrandProfileVersion,
                  replyBrandDisplayNameDigest:
                    responseContext.replyBrandDisplayNameDigest,
                  replyVoiceDigest: frame?.voiceDigest ?? null,
                  modelSnapshot: responseContext.modelSnapshot,
                  promptVersion: responseContext.promptVersion,
                  outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
                  outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
                  concreteLanguageTag: responseContext.concreteLanguage.tag,
                  templateGroup: responseContext.concreteLanguage.templateGroup,
                  renderedSuggestionDigest: renderDigest,
                  tokenExpiresAtEpochMillis: grant.replyTokenExpiresAtEpochMillis,
                  draftExpiresAtEpochMillis: grant.replyDraftExpiresAtEpochMillis,
                },
                dependencies.provenancePrivateKey,
              )
              return {
                route: 'reply-suggestion',
                status: 'success',
                settlementReceipt: receipt,
                result: {
                  profileVersion: responseContext.replyProfileVersion,
                  replyText,
                  provenanceToken,
                  expiresAtEpochMillis: grant.replyTokenExpiresAtEpochMillis,
                  baseReplyStateRevision: responseContext.baseReplyStateRevision,
                  concreteLanguageTag: responseContext.concreteLanguage.tag,
                  templateGroup: responseContext.concreteLanguage.templateGroup,
                },
              }
            },
          })
        },
      })
    },
  })
}
