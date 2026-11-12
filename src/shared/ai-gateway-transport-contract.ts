import { hasOnlyUnicodeScalars } from './ai-json'
import { REPLY_DRAFTING_V2_VERSIONS } from './reply-drafting-v2-schema'
import type { ReplyBodyIssueCode } from './domain/reply-body-lint-policy'
import type { ReplyDraftingV2Output } from './reply-drafting-v2-schema'
import { replyDraftingV2FrameSchema } from './reply-drafting-v2-frame'
import { z } from 'zod/v4'
import {
  aiExecutionBindingSchema,
  aiInternalCanonicalUuidSchema,
  aiInternalSafeIdSchema,
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
import {
  AI_RUNTIME_CAPABILITIES_V1,
  isExecutionCompatibleWithConsent,
} from './ai-runtime-capability-contract'
import type {
  AiAnalysisV2Output,
  AiTrendSelectionOutput,
} from './ai-route-output-schemas'
import {
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
  type PersonalizedReplyDraft,
} from './ai-personalized-reply-profile'
import { AI_PROVIDER_IDS } from './ai-provider-ids'
import { MAX_AI_REVIEW_SENTENCES_V1 } from './ai-review-source-contract'
import {
  REVIEW_ANALYSIS_V3_OPERATION_PROFILE,
  reviewSentencesAreNumberedFromOne,
  type ReviewAnalysisV3GatewayResult,
  reviewSentencesMatchText,
  isCatalogueReviewPropertyContext,
} from './review-analysis-v3-request'
import { reviewPropertyContextSchema } from './review-vocabulary-hints'

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u

const canonicalUuid = aiInternalCanonicalUuidSchema
const nonnegativeSafeInteger = z.number().int().nonnegative().safe()
const positiveSafeInteger = z.number().int().positive().safe()
const internalSubjectId = aiInternalSafeIdSchema

function hasOnlyAllowedUnicodeScalars(value: string): boolean {
  if (!hasOnlyUnicodeScalars(value)) return false
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)!
    if ((codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xffff) >= 0xfffe) {
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
        hasOnlyAllowedUnicodeScalars(value) &&
        [...value].length <= 64 &&
        !CONTROL_OR_FORMAT.test(value),
    ),
  z.null(),
])
const reviewText = z.union([
  z
    .string()
    .refine((value) => hasOnlyAllowedUnicodeScalars(value) && !value.includes('\0')),
  z.null(),
])
const reviewRating = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

const reviewSourceSchema = z
  .object({
    kind: z.literal('review'),
    text: reviewText,
    rating: reviewRating,
    languageCode: nullableLanguageCode,
    reviewedAtEpochMillis: nonnegativeSafeInteger,
  })
  .strict()

// The numbered sentences of a review-analysis v3 request (contract section 6.1):
// the canonical text cut by `review-sentences-v1` over the raw text, so a number
// the provider cites is the sentence the live display resolves. A sentence may be
// empty (it held only control characters) but keeps its number.
const reviewSentenceSchema = z
  .object({
    number: z.number().int().min(1).max(MAX_AI_REVIEW_SENTENCES_V1),
    text: z
      .string()
      .refine((value) => hasOnlyAllowedUnicodeScalars(value) && !value.includes('\0')),
  })
  .strict()

// The provider an operation was claimed under (contract section 7.1): the identity
// its row records, so the gateway can refuse an operation when the provider in
// force is another. Review-analysis v3 only.
const providerSelectionSchema = z
  .object({
    id: z.enum(AI_PROVIDER_IDS),
    model: z.string().min(1).max(100),
    requestProfileVersion: z.string().min(1).max(100),
    requestProfileDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

const reviewAnalysisSourceSchema = reviewSourceSchema.extend({
  sentences: z.array(reviewSentenceSchema).max(MAX_AI_REVIEW_SENTENCES_V1).optional(),
})

const replyBrandProfileSchema = z
  .object({
    displayName: z
      .string()
      .min(1)
      .max(120)
      .refine(
        (value) =>
          value === value.trim() &&
          value.normalize('NFKC') === value &&
          !CONTROL_OR_FORMAT.test(value),
      ),
  })
  .strict()

const replyLocalFrameSchema = z
  .object({
    prefix: z.string().max(2_000),
    suffix: z.string().max(4_096),
    voiceDigest: z.string().regex(/^[0-9a-f]{64}$/),
    reviewerDisplayName: z.string().max(200).nullable(),
    contact: z.string().max(200).nullable(),
    signerName: z.string().max(120).nullable(),
    signerTitle: z.string().max(120).nullable(),
    businessName: z.string().max(120),
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

const reviewAnalysisGatewayRequestSchema = z
  .object({
    ...commonShape,
    route: z.literal('review-analysis'),
    actorId: z.null(),
    redactionCountry: z.string().regex(/^[A-Z]{2}$/),
    observedContentExpiresAtEpochMillis: positiveSafeInteger,
    source: reviewAnalysisSourceSchema,
    // Review-analysis v3 only: the hints the provider is steered with, and the
    // provider the operation was claimed under.
    propertyContext: reviewPropertyContextSchema.optional(),
    provider: providerSelectionSchema.optional(),
  })
  .strict()

const replySuggestionGatewayRequestSchema = z
  .object({
    ...commonShape,
    route: z.literal('reply-suggestion'),
    actorId: actorIdSchema,
    redactionCountry: z.string().regex(/^[A-Z]{2}$/),
    observedContentExpiresAtEpochMillis: positiveSafeInteger,
    replyProfileVersion: z.enum([
      AI_PERSONALIZED_REPLY_PROFILE_VERSION,
      REPLY_DRAFTING_V2_VERSIONS.profile,
    ]),
    brandProfile: replyBrandProfileSchema,
    /** Local framing context. It is deliberately excluded from providerPayload. */
    replyLocalFrame: replyLocalFrameSchema.nullable().optional(),
    replyV2Frame: replyDraftingV2FrameSchema.optional(),
    tone: z.enum(['professional', 'friendly', 'casual']),
    source: reviewAnalysisSourceSchema,
  })
  .strict()

const propertyTrendGatewayRequestSchema = z
  .object({
    ...commonShape,
    route: z.literal('property-trend'),
    actorId: z.null(),
    source: propertyTrendProviderInputSchema,
  })
  .strict()

/**
 * A review-analysis request carries numbered sentences, a property context and the
 * provider it was claimed under exactly when it names the v3 operation profile, and
 * then the sentences must describe the text it carries: v2 has no use for any of
 * them and v3 cannot run without them.
 */
function reviewEvidenceIssue(
  request: Readonly<{
    binding: Readonly<{ operationProfileVersion: string }>
    source: z.infer<typeof reviewAnalysisSourceSchema>
    propertyContext?: z.infer<typeof reviewPropertyContextSchema> | undefined
    provider?: z.infer<typeof providerSelectionSchema> | undefined
  }>,
): string | null {
  const { sentences, text } = request.source
  const v3 =
    request.binding.operationProfileVersion === REVIEW_ANALYSIS_V3_OPERATION_PROFILE
  if (!v3) {
    return sentences !== undefined ||
      request.propertyContext !== undefined ||
      request.provider !== undefined
      ? 'analysis v2 route forbids an evidence request'
      : null
  }
  if (
    sentences === undefined ||
    request.propertyContext === undefined ||
    request.provider === undefined ||
    text === null
  ) {
    return 'analysis v3 route requires numbered sentences, a property context and a provider'
  }
  if (
    !reviewSentencesAreNumberedFromOne(sentences) ||
    !reviewSentencesMatchText(text, sentences)
  ) {
    return 'analysis v3 sentences are not the review text, numbered from one'
  }
  return isCatalogueReviewPropertyContext(request.propertyContext)
    ? null
    : 'analysis v3 property context is not the catalogue hint set for its category'
}

type GatewayRouteValue =
  | z.infer<typeof reviewAnalysisGatewayRequestSchema>
  | z.infer<typeof replySuggestionGatewayRequestSchema>
  | z.infer<typeof propertyTrendGatewayRequestSchema>

/** A review-analysis request must carry the evidence its operation profile asks for. */
function addReviewEvidenceIssue(
  value: GatewayRouteValue,
  context: z.RefinementCtx,
): void {
  if (value.route !== 'review-analysis') return
  const evidenceIssue = reviewEvidenceIssue(value)
  if (evidenceIssue !== null) context.addIssue({ code: 'custom', message: evidenceIssue })
}

function addReplyV2Issue(
  value: z.infer<typeof replySuggestionGatewayRequestSchema>,
  context: z.RefinementCtx,
): void {
  const v2 =
    value.binding.operationProfileVersion === REPLY_DRAFTING_V2_VERSIONS.operation
  if (!v2) {
    if (
      value.binding.replyDraftingV2 !== undefined ||
      value.replyV2Frame !== undefined ||
      value.source.sentences !== undefined ||
      value.replyProfileVersion !== AI_PERSONALIZED_REPLY_PROFILE_VERSION
    )
      context.addIssue({ code: 'custom', message: 'V1 forbids V2 fields' })
    return
  }
  if (
    !value.binding.replyDraftingV2 ||
    !value.replyV2Frame ||
    !value.source.sentences ||
    value.replyProfileVersion !== REPLY_DRAFTING_V2_VERSIONS.profile
  ) {
    context.addIssue({
      code: 'custom',
      message: 'V2 requires numbered source, options and frame',
    })
    return
  }
  if (
    value.replyLocalFrame != null ||
    value.replyV2Frame.voiceDigest !== value.binding.replyDraftingV2.voiceDigest ||
    !reviewSentencesAreNumberedFromOne(value.source.sentences) ||
    !reviewSentencesMatchText(value.source.text ?? '', value.source.sentences)
  )
    context.addIssue({ code: 'custom', message: 'V2 request binding mismatch' })
}

export const aiGatewayRouteRequestSchema = z
  .discriminatedUnion('route', [
    reviewAnalysisGatewayRequestSchema,
    replySuggestionGatewayRequestSchema,
    propertyTrendGatewayRequestSchema,
  ])
  // fallow-ignore-next-line complexity -- complexity unchanged from main; the finding moved with earlier code (ADR 0074 refactor)
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
      !isExecutionCompatibleWithConsent({
        capability: entry.capability,
        acknowledgedNotice: value.binding,
        servedExecution: {
          runtimeProfileVersion: value.binding.capabilityRuntimeProfileVersion,
          operationProfileVersion: value.binding.operationProfileVersion,
          providerDeploymentProfileVersion:
            value.binding.providerDeploymentProfileVersion,
        },
      })
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
    addReviewEvidenceIssue(value, context)
    if (value.route === 'reply-suggestion') {
      addReplyV2Issue(value, context)
      const language = value.binding.concreteReplyLanguage
      if (
        language === null ||
        value.binding.replyBrandProfileVersion === null ||
        value.binding.replyBrandProfileVersion === undefined ||
        value.binding.replyBrandDisplayNameDigest === null ||
        value.binding.replyBrandDisplayNameDigest === undefined ||
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
      value.binding.replyBrandProfileVersion != null ||
      value.binding.replyBrandDisplayNameDigest != null ||
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
export type ReviewAnalysisSourcePayload = z.infer<typeof reviewAnalysisSourceSchema>
export type { DeterministicAggregateWindow, DeterministicTrendCandidate }
export type PropertyTrendProviderInput = PropertyTrendProviderInputV1

export type AiGatewayErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'source_too_large'
  | 'invalid_request'
  | 'text_unavailable'
  | 'language_not_supported'
  | 'idempotency_conflict'
  | 'operation_in_progress'
  | 'operation_ambiguous'
  | 'operation_abandoned'
  | 'completed_without_delivery'
  | 'merchant_opt_in_required'
  | 'capability_not_opted_in'
  | 'execution_suspended'
  | 'source_expired'
  | 'source_epoch_changed'
  | 'source_revision_changed'
  | 'analysis_sequence_changed'
  | 'reply_state_changed'
  | 'draft_invalidated'
  | 'property_profile_changed'
  | 'routing_policy_changed'
  | 'provider_profile_changed'
  | 'capability_epoch_changed'
  | 'redaction_blocked'
  | 'quota_exhausted'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_refused'
  | 'output_invalid'
  | 'output_truncated'
  | 'policy_unavailable'

// The gateway builds every response in this process, from an answer its route
// already accepted and a receipt the settlement authority issued, so a response
// is a type rather than a schema parsed a second time.

type AnalysisPayload = AiAnalysisV2Output | ReviewAnalysisV3GatewayResult

type ReplyV1Payload = Omit<PersonalizedReplyDraft, 'languageCode' | 'grounding'> &
  Readonly<{
    profileVersion: typeof AI_PERSONALIZED_REPLY_PROFILE_VERSION
    concreteLanguageTag: string
    replyText: string
    provenanceToken: string
    expiresAtEpochMillis: number
    baseReplyStateRevision: number
    templateGroup: (typeof REPLY_TEMPLATE_LANGUAGE_GROUPS)[number]
  }>

type ReplyV2Payload = Readonly<{
  profileVersion: typeof REPLY_DRAFTING_V2_VERSIONS.profile
  concreteLanguageTag: string
  templateGroup: 'en-Latn' | 'es-Latn' | 'bg-Cyrl'
  replyText: string
  case: ReplyDraftingV2Output['case']
  mainPoint: readonly number[]
  provenanceToken: string
  expiresAtEpochMillis: number
  baseReplyStateRevision: number
}>

type GatewaySuccess<Route extends string, Payload> = Readonly<{
  route: Route
  status: 'success'
  result: Payload
  settlementReceipt: AiSettlementReceiptV1
}>

type GatewayError<Route extends string> = Readonly<{
  route: Route
  status: 'error'
  code: AiGatewayErrorCode
  retryAfterEpochMillis: number | null
}>

type ReplyGatewayError = GatewayError<'reply-suggestion'> &
  Readonly<{ rewriteIssues?: readonly ReplyBodyIssueCode[] }>

export type AnalysisResult =
  GatewaySuccess<'review-analysis', AnalysisPayload> | GatewayError<'review-analysis'>
export type ReplySuggestionResult =
  GatewaySuccess<'reply-suggestion', ReplyV1Payload | ReplyV2Payload> | ReplyGatewayError
export type TrendResult =
  | GatewaySuccess<'property-trend', AiTrendSelectionOutput>
  | GatewayError<'property-trend'>
export type AiGatewayRouteResponseV1 =
  AnalysisResult | ReplySuggestionResult | TrendResult
export type AiGatewayFailure =
  GatewayError<'review-analysis'> | ReplyGatewayError | GatewayError<'property-trend'>

/**
 * Which process may invoke which route.
 *
 * This used to be derived from a map of SPIFFE peer identities, because the
 * caller arrived as an mTLS client certificate and `assertAiGatewayPeerRoute`
 * turned that certificate into a caller before authorizing the route. WP2.3
 * collapsed the gateway into the calling process, so there is no peer to
 * identify and no certificate to map — the caller is simply which process this
 * is. The route authorization itself did not go with it: it still runs, against
 * `AI_RUNTIME_CAPABILITIES_V1`, in `ai-inprocess.adapter.ts`.
 *
 * `AI_GATEWAY_PATHS_V1` went at the same time. It mapped each route to the URL
 * path the sidecar served it on, and nothing serves URLs any more.
 */
export type AiGatewayCaller = 'web' | 'worker'

export function parseAiGatewayRouteRequest(value: unknown): AiGatewayRouteRequestV1 {
  return aiGatewayRouteRequestSchema.parse(value)
}

export type { AiExecutionBindingV1, AiSettlementReceiptV1 }
