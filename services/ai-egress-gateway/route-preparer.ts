import type { KeyObject } from 'node:crypto'
import { z } from 'zod'
import { zodTextFormat } from 'openai/helpers/zod'
import { canonicalizeRfc8785 } from '../../src/shared/merchant-ai-notice-contract'
import { encodeCanonicalAiReviewSource } from '../../src/shared/ai-review-source-contract'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  mapReviewLanguageMetadata,
  type ConcreteReplyLanguage,
  type EvaluatedReviewLanguage,
} from '../../src/shared/ai-review-language-catalogue'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from '../../src/shared/ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from '../../src/shared/ai-structured-marker-detectors'
import {
  AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
  resolveConcreteReplyLanguage,
  verifyReplyLanguageOutput,
  type ReplyLanguageDetector,
} from '../../src/shared/ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '../../src/shared/ai-language-script-consistency'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '../../src/shared/ai-zh-orthography-verifier'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
  resolveAiReplyTemplate,
} from '../../src/shared/ai-reply-template-catalogue'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
  scanAiReplyOutput,
} from '../../src/shared/ai-reply-output-leakage'
import {
  CLOSED_TREND_SIGNAL_IDS,
  validateTrendSelection,
  type ClosedTrendSignalId,
  type DeterministicTrendCandidate,
} from '../../src/shared/ai-property-trend-contract'
import {
  AI_ANALYSIS_OUTPUT_SCHEMA,
  AI_REPLY_SELECTION_OUTPUT_SCHEMA,
  AI_TREND_SELECTION_OUTPUT_SCHEMA,
} from '../../src/shared/openai-route-output-schemas'
import {
  AI_PROVIDER_DEPLOYMENT_PROFILE_V1,
  maximumCostMicros as maximumProviderCostMicros,
} from '../../src/shared/ai-openai-provider-profile'
import { AI_OPERATION_PROFILES } from '../../src/shared/ai-operation-profiles'
import type {
  AiAdmissionDescriptorV1,
  AiExecutionGrantV1,
  AiSettlementReceiptV1,
} from '../../src/shared/ai-internal-transport-contract'
import type { VersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import type {
  AiGatewayRouteRequestV1,
  AiGatewayRouteResponseV1,
} from '../../src/shared/ai-gateway-transport-contract'
import {
  GatewayPreparationError,
  OPENAI_PROMPT_VERSIONS,
  type AiGatewayRoutePreparer,
  type ClosedJsonSchemaFormat,
  type PreparedGatewayRouteExecution,
} from './contracts'
import {
  buildClosedOpenAiRequest,
  computePromptCacheShard,
  createPreparedAiInvocation,
  type DerivedDescriptorFacts,
} from './prepared-invocation'
import { derivePropertySafetyIdentifier } from './safety-identifier'
import { digestRenderedReply, signAiReplyProvenance } from './provenance'
const analysisOutputSchema = AI_ANALYSIS_OUTPUT_SCHEMA
const replySelectionSchema = AI_REPLY_SELECTION_OUTPUT_SCHEMA
const trendSelectionSchema = AI_TREND_SELECTION_OUTPUT_SCHEMA
const closedJsonSchemaFormatSchema = z
  .object({
    type: z.literal('json_schema'),
    name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    strict: z.literal(true),
    schema: z.record(z.string(), z.unknown()),
  })
  .strict()
const CLOSED_TREND_SIGNAL_ID_SET: ReadonlySet<string> = new Set<string>(
  CLOSED_TREND_SIGNAL_IDS,
)

function isClosedTrendSignalId(value: string): value is ClosedTrendSignalId {
  return CLOSED_TREND_SIGNAL_ID_SET.has(value)
}

const profileByRoute = new Map(
  AI_OPERATION_PROFILES.map((profile) => [profile.sourceRoute, profile]),
)

function profileFor(route: AiGatewayRouteRequestV1['route']) {
  const profile = profileByRoute.get(route)
  if (!profile || profile.sourceRoute === 'synthetic-canary')
    throw new GatewayPreparationError('policy_unavailable')
  return profile
}

function formatFor(
  profile: ReturnType<typeof profileFor>,
  outputSchema: z.ZodTypeAny,
): ClosedJsonSchemaFormat {
  return closedJsonSchemaFormatSchema.parse(
    JSON.parse(JSON.stringify(zodTextFormat(outputSchema, profile.outputSchemaName))),
  )
}

function maximumCostMicros(
  profile: ReturnType<typeof profileFor>,
  providerPayloadBytes: number,
): number {
  try {
    return maximumProviderCostMicros(profile, providerPayloadBytes)
  } catch {
    throw new GatewayPreparationError('policy_unavailable')
  }
}

function createDescriptor(
  request: AiGatewayRouteRequestV1,
  profile: ReturnType<typeof profileFor>,
  facts: DerivedDescriptorFacts,
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
      costMicros: maximumCostMicros(profile, facts.providerPayloadByteCount),
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
    request.binding.evaluatedLanguage !== mapped.language.tag
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

export function createAiGatewayRoutePreparer(
  dependencies: Readonly<{
    requestBindingKeys: VersionedHmacKeyring
    safetyIdentifierKey: Uint8Array
    replyLanguageDetector: ReplyLanguageDetector
    provenanceKid: string
    provenancePrivateKey: KeyObject
    now?: () => number
  }>,
): AiGatewayRoutePreparer {
  const now = dependencies.now ?? Date.now
  return Object.freeze({
    prepare: (request): PreparedGatewayRouteExecution => {
      const profile = profileFor(request.route)
      if (
        request.binding.operationProfileVersion !== profile.profileVersion ||
        request.binding.providerDeploymentProfileVersion !==
          profile.providerDeploymentProfileVersion ||
        request.binding.capabilityRuntimeProfileVersion !==
          profile.capabilityRuntimeProfileVersion
      )
        throw new GatewayPreparationError('policy_unavailable')

      let providerPayload: Readonly<Record<string, unknown>>
      let outputSchema: z.ZodTypeAny
      let responseContext:
        | Readonly<{ route: 'review-analysis' }>
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
            providerDeploymentProfileVersion: typeof AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion
            operationProfileVersion: 'reply-suggestion-v1'
            modelSnapshot: typeof AI_PROVIDER_DEPLOYMENT_PROFILE_V1.modelSnapshot
            promptVersion: (typeof OPENAI_PROMPT_VERSIONS)['reply-suggestion']
            concreteLanguage: ConcreteReplyLanguage
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
        if (request.route === 'review-analysis') {
          providerPayload = {
            reviewText: text,
            rating: request.source.rating,
            languageCode: evaluated.tag,
          }
          outputSchema = analysisOutputSchema
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
          const concrete = resolved.language
          if (
            request.binding.concreteReplyLanguage?.tag !== concrete.tag ||
            request.binding.concreteReplyLanguage.templateGroup !== concrete.templateGroup
          )
            throw new GatewayPreparationError('language_not_supported')
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
          if (profile.profileVersion !== 'reply-suggestion-v1') {
            throw new GatewayPreparationError('policy_unavailable')
          }
          const fence = request.binding.capabilityFence
          if (
            fence.capability !== 'reply_drafting' ||
            request.binding.sourceRevision === null
          )
            throw new GatewayPreparationError('policy_unavailable')
          providerPayload = {
            reviewText: text,
            rating: request.source.rating,
            languageCode: concrete.tag,
            tone: request.tone,
          }
          outputSchema = replySelectionSchema
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
            providerDeploymentProfileVersion: profile.providerDeploymentProfileVersion,
            operationProfileVersion: profile.profileVersion,
            modelSnapshot: AI_PROVIDER_DEPLOYMENT_PROFILE_V1.modelSnapshot,
            promptVersion: OPENAI_PROMPT_VERSIONS['reply-suggestion'],
            concreteLanguage: concrete,
          })
        }
      }
      const promptCacheShard = computePromptCacheShard({
        operationId: request.operationId,
        route: request.route,
        promptVersion: OPENAI_PROMPT_VERSIONS[request.route],
      })
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
      const sdkRequest = buildClosedOpenAiRequest({
        route: request.route,
        promptVersion: OPENAI_PROMPT_VERSIONS[request.route],
        promptCacheShard,
        developerMessage: profile.developerPrompt,
        untrustedData: canonicalizeRfc8785(providerPayload),
        format: formatFor(profile, outputSchema),
        maxOutputTokens: profile.maxOutputTokens,
        reasoningEffort: profile.reasoningEffort,
        safetyIdentifier,
      })
      const sourceBytes =
        request.route === 'property-trend'
          ? Buffer.from(`\u0002${canonicalizeRfc8785(request.source)}`, 'utf8')
          : reviewSourceBytes(request)
      let invocation
      try {
        invocation = createPreparedAiInvocation({
          sourceBytes,
          providerPayload,
          sdkRequest,
          createDescriptor: (facts) => createDescriptor(request, profile, facts),
          requestBindingKeys: dependencies.requestBindingKeys,
        })
      } finally {
        sourceBytes.fill(0)
      }
      return Object.freeze({
        invocation,
        outputSchema,
        acceptProviderResult: (rawResult: unknown) => {
          if (responseContext.route === 'review-analysis') {
            const result = analysisOutputSchema.safeParse(rawResult)
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
          const result = replySelectionSchema.safeParse(rawResult)
          if (
            !result.success ||
            result.data.languageCode !== responseContext.concreteLanguage.tag
          )
            return null
          let replyText: string
          try {
            replyText = resolveAiReplyTemplate({
              templateGroup: responseContext.concreteLanguage.templateGroup,
              tone: responseContext.tone,
              templateId: result.data.templateId,
            })
          } catch {
            return null
          }
          if (
            scanAiReplyOutput({
              text: replyText,
              countryCode: responseContext.redactionCountry,
              expectedProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
              expectedProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
              expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
            }) !== 'safe'
          )
            return null
          if (
            verifyReplyLanguageOutput(
              replyText,
              responseContext.concreteLanguage,
              dependencies.replyLanguageDetector,
            ).status !== 'valid'
          )
            return null
          const renderDigest = digestRenderedReply(replyText)
          const templateId = result.data.templateId
          return Object.freeze({
            buildResponse: (
              receipt: AiSettlementReceiptV1,
              grant: AiExecutionGrantV1,
            ): AiGatewayRouteResponseV1 => {
              if (
                grant.replyTokenExpiresAtEpochMillis === null ||
                grant.replyDraftExpiresAtEpochMillis === null ||
                grant.replyTokenExpiresAtEpochMillis <= now()
              )
                throw new GatewayPreparationError('output_invalid')
              const provenanceToken = signAiReplyProvenance(
                {
                  version: 'ai-reply-provenance-v1',
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
                  modelSnapshot: responseContext.modelSnapshot,
                  promptVersion: responseContext.promptVersion,
                  outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
                  outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
                  replyTemplateCatalogueVersion: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
                  replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
                  templateId,
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
                  replyText,
                  provenanceToken,
                  expiresAtEpochMillis: grant.replyTokenExpiresAtEpochMillis,
                  baseReplyStateRevision: responseContext.baseReplyStateRevision,
                  templateId,
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
