import { z } from 'zod/v4'
import {
  aiExecutionBindingSchema,
  aiInternalCanonicalUuidSchema,
  aiInternalSafeIdSchema,
  aiSettlementReceiptSchema,
  type AiExecutionBindingV1,
  type AiSettlementReceiptV1,
} from './ai-internal-transport-contract'
import {
  computeDeterministicTrendCandidates,
  validateDeterministicAggregateWindow,
  type DeterministicAggregateWindow,
  type DeterministicTrendCandidate,
} from './ai-property-trend-contract'
import {
  REPLY_TEMPLATE_LANGUAGE_GROUPS,
  parseCanonicalReplyLanguageTag,
} from './ai-review-language-catalogue'
import { AI_RUNTIME_CAPABILITIES_V1 } from './ai-runtime-capability-contract'
import {
  AI_ANALYSIS_OUTPUT_SCHEMA,
  AI_REPLY_SELECTION_OUTPUT_SCHEMA,
  AI_TREND_SELECTION_OUTPUT_SCHEMA,
} from './openai-route-output-schemas'

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u

const canonicalUuid = aiInternalCanonicalUuidSchema
const nonnegativeSafeInteger = z.number().int().nonnegative().safe()
const positiveSafeInteger = z.number().int().positive().safe()
const internalSubjectId = aiInternalSafeIdSchema

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
      const codePoint = (unit - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000
      if ((codePoint & 0xffff) >= 0xfffe) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    } else if ((unit >= 0xfdd0 && unit <= 0xfdef) || (unit & 0xffff) >= 0xfffe) {
      return false
    }
  }
  return true
}

const actorIdSchema = aiInternalSafeIdSchema
const nullableLanguageCode = z.union([
  z
    .string()
    .refine(
      (value) =>
        hasOnlyUnicodeScalars(value) &&
        [...value].length <= 64 &&
        !CONTROL_OR_FORMAT.test(value),
    ),
  z.null(),
])
const reviewText = z.union([
  z.string().refine((value) => hasOnlyUnicodeScalars(value) && !value.includes('\0')),
  z.null(),
])

const reviewSourceSchema = z
  .object({
    kind: z.literal('review'),
    text: reviewText,
    rating: z.number().int().min(1).max(5),
    languageCode: nullableLanguageCode,
    reviewedAtEpochMillis: nonnegativeSafeInteger,
  })
  .strict()

type PropertyTrendProviderInputV1 = Readonly<{
  languageCode: 'en'
  currentWindow: DeterministicAggregateWindow
  baselineWindow: DeterministicAggregateWindow
  candidates: readonly DeterministicTrendCandidate[]
}>

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function candidatesEqual(
  actual: unknown,
  expected: readonly DeterministicTrendCandidate[],
): actual is readonly DeterministicTrendCandidate[] {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.length === 0
  ) {
    return false
  }
  return actual.every((value, index) => {
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, [
        'id',
        'baselineNumerator',
        'baselineDenominator',
        'currentNumerator',
        'currentDenominator',
      ])
    ) {
      return false
    }
    const canonical = expected[index]!
    return (
      value.id === canonical.id &&
      value.baselineNumerator === canonical.baselineNumerator &&
      value.baselineDenominator === canonical.baselineDenominator &&
      value.currentNumerator === canonical.currentNumerator &&
      value.currentDenominator === canonical.currentDenominator
    )
  })
}

function parsePropertyTrendProviderInput(value: unknown): PropertyTrendProviderInputV1 {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      'languageCode',
      'currentWindow',
      'baselineWindow',
      'candidates',
    ]) ||
    value.languageCode !== 'en'
  ) {
    throw new TypeError('property trend provider input is invalid')
  }
  const currentWindow = validateDeterministicAggregateWindow(value.currentWindow)
  const baselineWindow = validateDeterministicAggregateWindow(value.baselineWindow)
  const candidates = computeDeterministicTrendCandidates({
    currentWindow,
    baselineWindow,
  })
  if (!candidatesEqual(value.candidates, candidates)) {
    throw new TypeError(
      'property trend candidates do not match the deterministic snapshot',
    )
  }
  return {
    languageCode: 'en',
    currentWindow,
    baselineWindow,
    candidates,
  }
}

const propertyTrendProviderInputSchema = z.unknown().transform((value, context) => {
  try {
    return parsePropertyTrendProviderInput(value)
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'property trend provider input is invalid',
    })
    return value as never
  }
})

const commonShape = {
  operationId: canonicalUuid,
  permitId: canonicalUuid,
  attemptNumber: z.number().int().min(1).max(4),
  organizationId: aiInternalSafeIdSchema,
  propertyId: canonicalUuid,
  internalSubjectId,
  binding: aiExecutionBindingSchema,
  deadlineEpochMillis: positiveSafeInteger,
} as const

export const reviewAnalysisGatewayRequestSchema = z
  .object({
    ...commonShape,
    route: z.literal('review-analysis'),
    actorId: z.null(),
    redactionCountry: z.string().regex(/^[A-Z]{2}$/),
    observedContentExpiresAtEpochMillis: positiveSafeInteger,
    source: reviewSourceSchema,
  })
  .strict()

export const replySuggestionGatewayRequestSchema = z
  .object({
    ...commonShape,
    route: z.literal('reply-suggestion'),
    actorId: actorIdSchema,
    redactionCountry: z.string().regex(/^[A-Z]{2}$/),
    observedContentExpiresAtEpochMillis: positiveSafeInteger,
    tone: z.enum(['professional', 'friendly', 'casual']),
    source: reviewSourceSchema,
  })
  .strict()

export const propertyTrendGatewayRequestSchema = z
  .object({
    ...commonShape,
    route: z.literal('property-trend'),
    actorId: z.null(),
    source: propertyTrendProviderInputSchema,
  })
  .strict()

export const aiGatewayRouteRequestSchema = z
  .discriminatedUnion('route', [
    reviewAnalysisGatewayRequestSchema,
    replySuggestionGatewayRequestSchema,
    propertyTrendGatewayRequestSchema,
  ])
  .superRefine((value, context) => {
    const capability = value.binding.capabilityFence.capability
    const entry = AI_RUNTIME_CAPABILITIES_V1.find(
      (candidate) => candidate.sourceRoute === value.route,
    )
    if (
      entry === undefined ||
      capability !== entry.capability ||
      value.binding.capabilityRuntimeProfileVersion !== entry.runtimeProfileVersion ||
      value.binding.operationProfileVersion !== entry.operationProfileVersion ||
      value.binding.providerDeploymentProfileVersion !==
        entry.providerDeploymentProfileVersion ||
      value.binding.noticeVersion !== entry.noticeVersion ||
      value.binding.noticeDigest !== entry.noticeDigest
    ) {
      context.addIssue({ code: 'custom', message: 'route binding is cross-wired' })
    }
    if (value.route === 'property-trend') {
      if (
        value.binding.sourceRevision !== null ||
        value.binding.reviewedAtEpochMillis !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'trend route forbids review source binding',
        })
      }
      return
    }
    if (
      value.binding.sourceRevision === null ||
      value.binding.reviewedAtEpochMillis === null ||
      value.binding.reviewedAtEpochMillis !== value.source.reviewedAtEpochMillis
    ) {
      context.addIssue({
        code: 'custom',
        message: 'review route source binding is inconsistent',
      })
    }
    if (value.route === 'reply-suggestion') {
      const language = value.binding.concreteReplyLanguage
      if (
        language === null ||
        value.binding.outputLeakageProfileVersion === null ||
        value.binding.outputLeakageProfileDigest === null ||
        value.binding.replyTemplateCatalogueVersion === null ||
        value.binding.replyTemplateCatalogueDigest === null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'reply route output binding is incomplete',
        })
      } else {
        const mapped = parseCanonicalReplyLanguageTag(language.tag)
        if (mapped === null || mapped.templateGroup !== language.templateGroup) {
          context.addIssue({
            code: 'custom',
            message: 'reply language tag and template group are cross-wired',
          })
        }
      }
    } else if (
      value.binding.concreteReplyLanguage !== null ||
      value.binding.outputLeakageProfileVersion !== null ||
      value.binding.outputLeakageProfileDigest !== null ||
      value.binding.replyTemplateCatalogueVersion !== null ||
      value.binding.replyTemplateCatalogueDigest !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'analysis route forbids reply output binding',
      })
    }
  })

export type AiGatewayRouteRequestV1 = z.infer<typeof aiGatewayRouteRequestSchema>
export type ReviewAnalysisGatewayRequestV1 = z.infer<
  typeof reviewAnalysisGatewayRequestSchema
>
export type ReplySuggestionGatewayRequestV1 = z.infer<
  typeof replySuggestionGatewayRequestSchema
>
export type PropertyTrendGatewayRequestV1 = z.infer<
  typeof propertyTrendGatewayRequestSchema
>
export type ReviewAiSourcePayload = z.infer<typeof reviewSourceSchema>
export type { DeterministicAggregateWindow, DeterministicTrendCandidate }
export type PropertyTrendProviderInput = PropertyTrendProviderInputV1

const aiErrorCodeSchema = z.enum([
  'forbidden',
  'not_found',
  'source_too_large',
  'invalid_request',
  'text_unavailable',
  'language_not_supported',
  'idempotency_conflict',
  'operation_in_progress',
  'operation_ambiguous',
  'completed_without_delivery',
  'merchant_opt_in_required',
  'capability_not_opted_in',
  'execution_suspended',
  'source_expired',
  'source_epoch_changed',
  'source_revision_changed',
  'analysis_sequence_changed',
  'reply_state_changed',
  'draft_invalidated',
  'property_profile_changed',
  'routing_policy_changed',
  'provider_profile_changed',
  'capability_epoch_changed',
  'redaction_blocked',
  'quota_exhausted',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_refused',
  'output_invalid',
  'output_truncated',
  'policy_unavailable',
])

const analysisPayloadSchema = AI_ANALYSIS_OUTPUT_SCHEMA

const replySelectionGatewaySchema = AI_REPLY_SELECTION_OUTPUT_SCHEMA.omit({
  languageCode: true,
}).extend({
  concreteLanguageTag: AI_REPLY_SELECTION_OUTPUT_SCHEMA.shape.languageCode,
})

const replyPayloadSchema = replySelectionGatewaySchema
  .extend({
    replyText: z
      .string()
      .min(1)
      .refine((value) => utf8ByteLength(value) <= 16_384),
    provenanceToken: z.string().min(1).max(32_768),
    expiresAtEpochMillis: positiveSafeInteger,
    baseReplyStateRevision: nonnegativeSafeInteger,
    templateGroup: z.enum(REPLY_TEMPLATE_LANGUAGE_GROUPS),
  })
  .superRefine((value, context) => {
    const mapped = parseCanonicalReplyLanguageTag(value.concreteLanguageTag)
    if (mapped === null || mapped.templateGroup !== value.templateGroup) {
      context.addIssue({
        code: 'custom',
        message: 'reply language tag and template group are cross-wired',
      })
    }
  })

const trendPayloadSchema = AI_TREND_SELECTION_OUTPUT_SCHEMA

function successSchema<Route extends string, Payload extends z.ZodTypeAny>(
  route: Route,
  payload: Payload,
) {
  return z
    .object({
      route: z.literal(route),
      status: z.literal('success'),
      result: payload,
      settlementReceipt: aiSettlementReceiptSchema,
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.settlementReceipt.disposition !== 'success' ||
        value.settlementReceipt.settlementState !== 'settled'
      ) {
        context.addIssue({ code: 'custom', message: 'success requires settled receipt' })
      }
    })
}

function errorSchema<Route extends string>(route: Route) {
  return z
    .object({
      route: z.literal(route),
      status: z.literal('error'),
      code: aiErrorCodeSchema,
      retryAfterEpochMillis: z.union([positiveSafeInteger, z.null()]),
    })
    .strict()
}

const analysisSuccessSchema = successSchema('review-analysis', analysisPayloadSchema)
const replySuccessSchema = successSchema('reply-suggestion', replyPayloadSchema)
const trendSuccessSchema = successSchema('property-trend', trendPayloadSchema)
const analysisErrorSchema = errorSchema('review-analysis')
const replyErrorSchema = errorSchema('reply-suggestion')
const trendErrorSchema = errorSchema('property-trend')

export const aiGatewayRouteResponseSchema = z.union([
  analysisSuccessSchema,
  analysisErrorSchema,
  replySuccessSchema,
  replyErrorSchema,
  trendSuccessSchema,
  trendErrorSchema,
])

export type AiGatewayRouteResponseV1 = z.infer<typeof aiGatewayRouteResponseSchema>
export type AnalysisResult =
  z.infer<typeof analysisSuccessSchema> | z.infer<typeof analysisErrorSchema>
export type ReplySuggestionResult =
  z.infer<typeof replySuccessSchema> | z.infer<typeof replyErrorSchema>
export type TrendResult =
  z.infer<typeof trendSuccessSchema> | z.infer<typeof trendErrorSchema>
export type AiGatewayFailure =
  | z.infer<typeof analysisErrorSchema>
  | z.infer<typeof replyErrorSchema>
  | z.infer<typeof trendErrorSchema>

export const AI_GATEWAY_PATHS_V1 = Object.freeze(
  Object.fromEntries(
    AI_RUNTIME_CAPABILITIES_V1.map((entry) => [entry.sourceRoute, entry.gatewayPath]),
  ) as Readonly<Record<AiGatewayRouteRequestV1['route'], string>>,
)

const PEER_CALLERS = Object.freeze({
  'spiffe://repkey.internal/repkey-web': 'web',
  'spiffe://repkey.internal/repkey-worker': 'worker',
} as const)

export type AiGatewayCaller = (typeof PEER_CALLERS)[keyof typeof PEER_CALLERS]

export function assertAiGatewayPeerRoute(
  route: AiGatewayRouteRequestV1['route'],
  peerIdentity: string | null,
): AiGatewayCaller {
  const caller =
    peerIdentity === null
      ? undefined
      : PEER_CALLERS[peerIdentity as keyof typeof PEER_CALLERS]
  const entry = AI_RUNTIME_CAPABILITIES_V1.find(
    (candidate) => candidate.sourceRoute === route,
  )
  if (caller === undefined || entry === undefined || entry.caller !== caller) {
    throw new TypeError('AI gateway peer identity is not authorized for route')
  }
  return caller
}

export function parseAiGatewayRouteRequest(value: unknown): AiGatewayRouteRequestV1 {
  return aiGatewayRouteRequestSchema.parse(value)
}

export function parseAiGatewayRouteResponse(value: unknown): AiGatewayRouteResponseV1 {
  return aiGatewayRouteResponseSchema.parse(value)
}

export type { AiExecutionBindingV1, AiSettlementReceiptV1 }
