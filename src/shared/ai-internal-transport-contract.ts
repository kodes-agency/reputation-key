import { sign, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import type { VersionedHmacKeyring } from './security/versioned-hmac-keyring'

export const AI_REVIEW_ROUTE_MAX_BYTES = 65_536 as const
export const AI_INTERNAL_RESPONSE_MAX_BYTES = 65_536 as const

const REQUEST_BINDING_AUDIENCE = 'ai-request-binding-v1'
const GRANT_DOMAIN = 'ai-execution-grant-v1\0'
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/
const KEY_ID = /^[a-z][a-z0-9_-]{0,31}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/
const RELEASE_SHA = /^[0-9a-f]{40}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/
const HMAC = /^[A-Za-z0-9_-]{43}$/

export const aiInternalCanonicalUuidSchema = z.string().regex(UUID)
export const aiInternalSafeIdSchema = z.string().regex(SAFE_ID)
const canonicalUuid = aiInternalCanonicalUuidSchema
const safeId = aiInternalSafeIdSchema
const digest = z.string().regex(SHA256)
const nullableDigest = z.union([digest, z.null()])
const nonnegative = z.number().int().nonnegative().safe()
const positive = z.number().int().positive().safe()
const keyId = z.string().regex(KEY_ID)
const hmac = z
  .string()
  .regex(HMAC)
  .refine((value) => {
    try {
      return Buffer.from(value, 'base64url').toString('base64url') === value
    } catch {
      return false
    }
  })
const nonce = z
  .string()
  .min(1)
  .max(128)
  .regex(BASE64URL)
  .refine((value) => {
    try {
      return Buffer.from(value, 'base64url').toString('base64url') === value
    } catch {
      return false
    }
  })
const signature = z
  .string()
  .length(86)
  .regex(BASE64URL)
  .refine((value) => {
    try {
      const decoded = Buffer.from(value, 'base64url')
      return decoded.byteLength === 64 && decoded.toString('base64url') === value
    } catch {
      return false
    }
  })

const limitsSchema = z
  .object({
    sourceBytes: positive,
    providerPayloadBytes: positive,
    preparedRequestBytes: positive,
    responseBytes: positive,
    outputTokens: positive,
    costMicros: positive,
  })
  .strict()

const normalStopFenceSchema = z
  .object({
    globalControlId: canonicalUuid,
    globalGeneration: positive,
    providerControlId: canonicalUuid,
    providerGeneration: positive,
    capabilityControlId: canonicalUuid,
    capabilityGeneration: positive,
  })
  .strict()

const capabilityFenceSchema = z.discriminatedUnion('capability', [
  z
    .object({
      capability: z.literal('review_analysis'),
      reviewAnalysisEpoch: positive,
    })
    .strict(),
  z
    .object({
      capability: z.literal('reply_drafting'),
      replyDraftingEpoch: positive,
      baseReplyStateRevision: nonnegative,
    })
    .strict(),
])

const concreteLanguageSchema = z.object({ tag: safeId, templateGroup: safeId }).strict()
export const aiExecutionBindingSchema = z
  .object({
    replyDraftingV2: replyDraftingV2BindingSchema.optional(),
    authorizationLineageId: canonicalUuid,
    noticeVersion: safeId,
    noticeDigest: digest,
    capabilityFence: capabilityFenceSchema,
    // 0-based source epoch (drizzle/0060): a never-edited property sits at 0.
    // propertyProfileVersion and routingPolicyVersion below stay 1-based.
    sourceEpoch: nonnegative,
    evaluatedLanguage: z.union([safeId, z.null()]),
    concreteReplyLanguage: z.union([concreteLanguageSchema, z.null()]),
    languageCatalogueDigest: nullableDigest,
    replyLanguageVerifierDigest: nullableDigest,
    languageScriptConsistencyDigest: nullableDigest,
    zhOrthographyVerifierDigest: nullableDigest,
    sourceRevision: z.union([nonnegative, z.null()]),
    reviewedAtEpochMillis: z.union([nonnegative, z.null()]),
    propertyProfileVersion: positive,
    // Optional only for decoding pre-grounding operation bindings. New Reply
    // Drafting admission requires both fields in the route refinement.
    replyBrandProfileVersion: z.union([positive, z.null()]).optional(),
    replyBrandDisplayNameDigest: nullableDigest.optional(),
    routingPolicyVersion: positive,
    sourcePolicyId: safeId,
    sourceCanonicalizerDigest: digest,
    redactionProfileVersion: safeId,
    outputLeakageProfileVersion: z.union([safeId, z.null()]),
    outputLeakageProfileDigest: nullableDigest,
    replyTemplateCatalogueVersion: z.union([safeId, z.null()]),
    replyTemplateCatalogueDigest: nullableDigest,
    providerDeploymentProfileVersion: safeId,
    operationProfileVersion: safeId,
    capabilityRuntimeProfileVersion: safeId,
    aiSubjectHmacKeyVersion: z.union([keyId, z.null()]),
    stopFence: normalStopFenceSchema,
  })
  .strict()

const canaryStopFenceEntrySchema = z
  .object({
    capability: z.enum(['review_analysis', 'reply_drafting']),
    capabilityControlId: canonicalUuid,
    capabilityGeneration: positive,
  })
  .strict()
const canaryBindingSchema = z
  .object({
    canaryAuthorizationId: canonicalUuid,
    canaryAuthorizationGeneration: z.number().int().min(1).max(3),
    releaseSha: z.string().regex(RELEASE_SHA),
    canaryProfileVersion: safeId,
    safetyIdentifierProfileVersion: z.literal('synthetic-canary-safety-v1'),
    providerDeploymentProfileVersion: safeId,
    operationProfileVersion: safeId,
    stopFence: z
      .object({
        globalControlId: canonicalUuid,
        globalGeneration: positive,
        providerControlId: canonicalUuid,
        providerGeneration: positive,
        allCapabilityStopFences: z
          .tuple([
            canaryStopFenceEntrySchema.extend({
              capability: z.literal('review_analysis'),
            }),
            canaryStopFenceEntrySchema.extend({
              capability: z.literal('reply_drafting'),
            }),
          ])
          .readonly(),
      })
      .strict(),
  })
  .strict()

const descriptorBaseShape = {
  version: z.literal('ai-admission-descriptor-v1'),
  operationId: canonicalUuid,
  permitId: canonicalUuid,
  attemptNumber: z.number().int().min(1).max(4),
  sourceDigest: digest,
  preparedDigest: digest,
  sourceByteCount: nonnegative,
  preparedByteCount: nonnegative,
  providerPayloadByteCount: nonnegative,
  promptCacheShard: z.number().int().min(0).max(15),
  limits: limitsSchema,
  callerDeadlineEpochMillis: positive,
} as const
const propertyDescriptorShape = {
  ...descriptorBaseShape,
  subjectKind: z.literal('property'),
  organizationId: safeId,
  propertyId: canonicalUuid,
  internalSubjectId: safeId,
  binding: aiExecutionBindingSchema,
  canaryBinding: z.null(),
  releaseSha: z.null(),
  canaryAuthorizationId: z.null(),
  redactionProfileVersion: safeId,
  outputLeakageProfileVersion: z.union([safeId, z.null()]),
  outputLeakageProfileDigest: nullableDigest,
  replyTemplateCatalogueVersion: z.union([safeId, z.null()]),
  replyTemplateCatalogueDigest: nullableDigest,
} as const

const reviewAnalysisDescriptorSchema = z
  .object({
    ...propertyDescriptorShape,
    route: z.literal('review-analysis'),
    actorId: z.null(),
    observedContentExpiresAtEpochMillis: positive,
    redactionCountry: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict()
const replySuggestionDescriptorSchema = z
  .object({
    ...propertyDescriptorShape,
    route: z.literal('reply-suggestion'),
    actorId: safeId,
    observedContentExpiresAtEpochMillis: positive,
    redactionCountry: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict()
const canaryDescriptorSchema = z
  .object({
    ...descriptorBaseShape,
    subjectKind: z.literal('synthetic_canary'),
    route: z.literal('synthetic-canary'),
    organizationId: z.null(),
    propertyId: z.null(),
    internalSubjectId: z.null(),
    actorId: z.null(),
    binding: z.null(),
    canaryBinding: canaryBindingSchema,
    releaseSha: z.string().regex(RELEASE_SHA),
    canaryAuthorizationId: canonicalUuid,
    observedContentExpiresAtEpochMillis: z.null(),
    redactionCountry: z.null(),
    redactionProfileVersion: z.null(),
    outputLeakageProfileVersion: z.null(),
    outputLeakageProfileDigest: z.null(),
    replyTemplateCatalogueVersion: z.null(),
    replyTemplateCatalogueDigest: z.null(),
  })
  .strict()

const admissionDescriptorSchema = z.discriminatedUnion('route', [
  reviewAnalysisDescriptorSchema,
  replySuggestionDescriptorSchema,
  canaryDescriptorSchema,
])

type PropertyDescriptor = Exclude<
  z.infer<typeof admissionDescriptorSchema>,
  { route: 'synthetic-canary' }
>

function validateReplyDescriptorProfiles(
  value: PropertyDescriptor,
  context: z.RefinementCtx,
): void {
  if (value.route === 'reply-suggestion') {
    if (
      value.binding.concreteReplyLanguage === null ||
      value.binding.replyBrandProfileVersion == null ||
      value.binding.replyBrandDisplayNameDigest == null ||
      value.outputLeakageProfileVersion === null ||
      value.outputLeakageProfileDigest === null ||
      value.replyTemplateCatalogueVersion === null ||
      value.replyTemplateCatalogueDigest === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'reply descriptor requires output profiles',
      })
    }
  } else if (
    value.binding.concreteReplyLanguage !== null ||
    value.binding.replyBrandProfileVersion != null ||
    value.binding.replyBrandDisplayNameDigest != null ||
    value.outputLeakageProfileVersion !== null ||
    value.outputLeakageProfileDigest !== null ||
    value.replyTemplateCatalogueVersion !== null ||
    value.replyTemplateCatalogueDigest !== null
  ) {
    context.addIssue({
      code: 'custom',
      message: 'non-reply descriptor forbids reply output profiles',
    })
  }
}

function validatePropertyDescriptor(
  value: PropertyDescriptor,
  context: z.RefinementCtx,
): void {
  const profileFields = [
    'redactionProfileVersion',
    'outputLeakageProfileVersion',
    'outputLeakageProfileDigest',
    'replyTemplateCatalogueVersion',
    'replyTemplateCatalogueDigest',
  ] as const
  if (profileFields.some((field) => value[field] !== value.binding[field])) {
    context.addIssue({
      code: 'custom',
      message: 'property descriptor profile binding is inconsistent',
    })
  }
  const capabilities = {
    'review-analysis': 'review_analysis',
    'reply-suggestion': 'reply_drafting',
  } as const
  if (capabilities[value.route] !== value.binding.capabilityFence.capability) {
    context.addIssue({
      code: 'custom',
      message: 'descriptor route and capability are inconsistent',
    })
  }
  validateReplyDescriptorProfiles(value, context)
}

export const aiAdmissionDescriptorSchema = admissionDescriptorSchema.superRefine(
  (value, context) => {
    if (
      value.sourceByteCount > value.limits.sourceBytes ||
      value.providerPayloadByteCount > value.limits.providerPayloadBytes ||
      value.preparedByteCount > value.limits.preparedRequestBytes
    ) {
      context.addIssue({
        code: 'custom',
        message: 'descriptor byte count exceeds its limit',
      })
    }
    if (value.route === 'synthetic-canary') {
      if (
        value.releaseSha !== value.canaryBinding.releaseSha ||
        value.canaryAuthorizationId !== value.canaryBinding.canaryAuthorizationId ||
        value.promptCacheShard !== 0
      ) {
        context.addIssue({
          code: 'custom',
          message: 'canary descriptor binding is inconsistent',
        })
      }
    } else {
      validatePropertyDescriptor(value, context)
    }
  },
)

export type AiExecutionBindingV1 = z.infer<typeof aiExecutionBindingSchema>
export type AiCanaryExecutionBindingV1 = z.infer<typeof canaryBindingSchema>
export type AiAdmissionLimitsV1 = z.infer<typeof limitsSchema>
export type AiAdmissionDescriptorV1 = z.infer<typeof aiAdmissionDescriptorSchema>

const admissionRequestSchema = z
  .object({
    descriptor: aiAdmissionDescriptorSchema,
    requestBindingKeyId: keyId,
    requestBindingHmac: hmac,
  })
  .strict()
export type AiAdmissionRequestV1 = z.infer<typeof admissionRequestSchema>

const grantBaseSchema = z
  .object({
    version: z.literal('ai-execution-grant-v1'),
    subjectKind: z.enum(['property', 'synthetic_canary']),
    grantKid: keyId,
    requestBindingKeyId: keyId,
    requestBindingHmac: hmac,
    route: z.enum(['review-analysis', 'reply-suggestion', 'synthetic-canary']),
    operationId: canonicalUuid,
    permitId: canonicalUuid,
    attemptNumber: z.number().int().min(1).max(4),
    nonce,
    limits: limitsSchema,
    callerDeadlineEpochMillis: positive,
    issuedAtEpochMillis: positive,
    expiresAtEpochMillis: positive,
    replyTokenExpiresAtEpochMillis: z.union([positive, z.null()]),
    replyDraftExpiresAtEpochMillis: z.union([positive, z.null()]),
  })
  .strict()
function validateGrantFields(
  value: z.infer<typeof grantBaseSchema>,
  context: z.RefinementCtx,
): void {
  const replyRoute = value.route === 'reply-suggestion'
  const tokenPresent = value.replyTokenExpiresAtEpochMillis !== null
  const draftPresent = value.replyDraftExpiresAtEpochMillis !== null
  if (
    value.expiresAtEpochMillis <= value.issuedAtEpochMillis ||
    value.expiresAtEpochMillis !== value.callerDeadlineEpochMillis ||
    (value.route === 'synthetic-canary') !== (value.subjectKind === 'synthetic_canary') ||
    tokenPresent !== draftPresent ||
    replyRoute !== (tokenPresent && draftPresent) ||
    (tokenPresent &&
      draftPresent &&
      value.replyTokenExpiresAtEpochMillis! > value.replyDraftExpiresAtEpochMillis!)
  ) {
    context.addIssue({ code: 'custom', message: 'grant fields are inconsistent' })
  }
}
const unsignedGrantSchema = grantBaseSchema.superRefine(validateGrantFields)
const grantSchema = grantBaseSchema
  .extend({ grantSignature: signature })
  .strict()
  .superRefine(validateGrantFields)
export type AiExecutionGrantUnsignedV1 = z.infer<typeof unsignedGrantSchema>
export type AiExecutionGrantV1 = z.infer<typeof grantSchema>

const AI_GATEWAY_REPORTED_DISPOSITIONS = [
  'success',
  'no_dispatch',
  'provider_refused',
  'output_invalid',
  // A truncated answer is a successful, fully-billed provider call that
  // returned nothing usable. Folding it into `output_invalid` made it
  // indistinguishable from a malformed answer, and that is what hid a global
  // reasoning-effort fault: every route spent its whole output budget on
  // reasoning and returned an empty body, while the operator saw four words.
  'output_truncated',
  'rate_limited',
  // The provider's 429 for an account out of credit, which no retry in seconds
  // can help; read as `rate_limited`, it went unnamed for 40 hours (2026-10-24).
  'quota_exhausted',
  'provider_unavailable',
  'caller_aborted',
  'deadline_exceeded',
  'transport_ambiguous',
] as const
/** What the gateway reports, plus the two outcomes only admission decides. */
const AI_PROVIDER_DISPOSITIONS = [
  ...AI_GATEWAY_REPORTED_DISPOSITIONS,
  'source_stale',
  'policy_denied',
] as const
type SettlementUsage = Pick<
  z.infer<typeof receiptBaseSchema>,
  | 'disposition'
  | 'reportedDisposition'
  | 'usageKnown'
  | 'providerRetryable'
  | 'inputTokens'
  | 'cachedInputTokens'
  | 'outputTokens'
  | 'reasoningTokens'
>

function hasUsageTokens(value: SettlementUsage): boolean {
  return [
    value.inputTokens,
    value.cachedInputTokens,
    value.outputTokens,
    value.reasoningTokens,
  ].some((count) => count !== 0)
}

function hasInconsistentRetryability(value: SettlementUsage): boolean {
  const retryableDisposition =
    value.reportedDisposition === 'rate_limited' ||
    value.reportedDisposition === 'provider_unavailable'
  if (value.providerRetryable) {
    return value.disposition !== value.reportedDisposition || !retryableDisposition
  }
  return (
    value.reportedDisposition === 'rate_limited' &&
    value.disposition === value.reportedDisposition
  )
}

function hasInconsistentSettlementUsage(value: SettlementUsage): boolean {
  return (
    value.cachedInputTokens > value.inputTokens ||
    value.reasoningTokens > value.outputTokens ||
    (!value.usageKnown && hasUsageTokens(value)) ||
    (value.disposition === 'success' && !value.usageKnown) ||
    hasInconsistentRetryability(value)
  )
}

function validateReceiptUsage(
  value: z.infer<typeof receiptBaseSchema>,
  context: z.RefinementCtx,
): void {
  const expectedState =
    value.disposition === 'no_dispatch'
      ? 'released'
      : value.disposition === 'transport_ambiguous'
        ? 'ambiguous'
        : 'settled'
  if (
    hasInconsistentSettlementUsage(value) ||
    value.settlementState !== expectedState ||
    (value.disposition === 'no_dispatch' && (value.usageKnown || value.costMicros !== 0))
  ) {
    context.addIssue({ code: 'custom', message: 'receipt usage is inconsistent' })
  }
}

const receiptBaseSchema = z
  .object({
    version: z.literal('ai-settlement-receipt-v1'),
    grantKid: keyId,
    operationId: canonicalUuid,
    permitId: canonicalUuid,
    attemptNumber: z.number().int().min(1).max(4),
    nonce,
    requestBindingHmac: hmac,
    disposition: z.enum(AI_PROVIDER_DISPOSITIONS),
    reportedDisposition: z.enum(AI_GATEWAY_REPORTED_DISPOSITIONS),
    providerRetryable: z.boolean(),
    usageKnown: z.boolean(),
    inputTokens: nonnegative,
    cachedInputTokens: nonnegative,
    outputTokens: nonnegative,
    reasoningTokens: nonnegative,
    costMicros: nonnegative,
    settledAtEpochMillis: positive,
    settlementState: z.enum(['settled', 'released', 'ambiguous']),
  })
  .strict()
const receiptSchema = receiptBaseSchema.superRefine(validateReceiptUsage)
export const aiSettlementReceiptSchema = receiptSchema
export type AiSettlementReceiptV1 = z.infer<typeof receiptSchema>

/**
 * Validates the admission envelope before binding its descriptor or issuing
 * a signed execution grant.
 */
export function parseAiAdmissionRequest(value: unknown): AiAdmissionRequestV1 {
  return admissionRequestSchema.parse(value)
}

export function signAiRequestBinding(
  descriptor: AiAdmissionDescriptorV1,
  keyring: VersionedHmacKeyring,
): AiAdmissionRequestV1 {
  const parsed = aiAdmissionDescriptorSchema.parse(descriptor)
  const signed = keyring.sign(REQUEST_BINDING_AUDIENCE, canonicalizeRfc8785(parsed))
  return admissionRequestSchema.parse({
    descriptor: parsed,
    requestBindingKeyId: signed.keyVersion,
    requestBindingHmac: signed.digest,
  })
}

export function verifyAiRequestBinding(
  request: AiAdmissionRequestV1,
  keyring: VersionedHmacKeyring,
): boolean {
  const parsed = admissionRequestSchema.safeParse(request)
  return (
    parsed.success &&
    keyring.verify(
      REQUEST_BINDING_AUDIENCE,
      canonicalizeRfc8785(parsed.data.descriptor),
      parsed.data.requestBindingKeyId,
      parsed.data.requestBindingHmac,
    )
  )
}

export function parseAiExecutionGrant(value: unknown): AiExecutionGrantV1 {
  return grantSchema.parse(value)
}

export function signAiExecutionGrant(
  unsigned: AiExecutionGrantUnsignedV1,
  privateKey: KeyObject,
): AiExecutionGrantV1 {
  const parsed = unsignedGrantSchema.parse(unsigned)
  const canonical = canonicalAiSigningBytes(GRANT_DOMAIN, parsed)
  let signature: Buffer | null = null
  try {
    signature = sign(null, canonical, privateKey)
    return grantSchema.parse({
      ...parsed,
      grantSignature: signature.toString('base64url'),
    })
  } finally {
    canonical.fill(0)
    signature?.fill(0)
  }
}

export function verifyAiExecutionGrant(
  grant: AiExecutionGrantV1,
  publicKeys: ReadonlyMap<string, KeyObject>,
): boolean {
  const parsed = grantSchema.safeParse(grant)
  if (!parsed.success) return false
  const { grantSignature, ...unsigned } = parsed.data
  const key = publicKeys.get(unsigned.grantKid)
  if (key === undefined) return false
  const canonical = canonicalAiSigningBytes(GRANT_DOMAIN, unsigned)
  const signature = Buffer.from(grantSignature, 'base64url')
  try {
    return verify(null, canonical, key, signature)
  } finally {
    canonical.fill(0)
    signature.fill(0)
  }
}

export function parseAiSettlementReceipt(value: unknown): AiSettlementReceiptV1 {
  return receiptSchema.parse(value)
}

export const aiSettlementRequestSchema = z
  .object({
    operationId: canonicalUuid,
    permitId: canonicalUuid,
    attemptNumber: z.number().int().min(1).max(4),
    nonce,
    disposition: z.enum(AI_GATEWAY_REPORTED_DISPOSITIONS),
    reportedDisposition: z.enum(AI_GATEWAY_REPORTED_DISPOSITIONS),
    providerRetryable: z.boolean(),
    usageKnown: z.boolean(),
    inputTokens: nonnegative,
    cachedInputTokens: nonnegative,
    outputTokens: nonnegative,
    reasoningTokens: nonnegative,
    retryAfterSeconds: z.union([z.number().int().min(1).max(300), z.null()]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      hasInconsistentSettlementUsage(value) ||
      (value.disposition === 'no_dispatch' &&
        (value.usageKnown ||
          hasUsageTokens(value) ||
          value.retryAfterSeconds !== null)) ||
      (value.retryAfterSeconds !== null && !value.providerRetryable)
    ) {
      context.addIssue({ code: 'custom', message: 'settlement usage is inconsistent' })
    }
  })
export type AiSettlementRequestV1 = z.infer<typeof aiSettlementRequestSchema>

export type AiSettlementPermit = Pick<
  AiExecutionGrantV1,
  'operationId' | 'permitId' | 'attemptNumber' | 'nonce' | 'grantKid'
>
export type AiSettlementOutcome = Omit<
  AiSettlementRequestV1,
  'operationId' | 'permitId' | 'attemptNumber' | 'nonce'
>

import { canonicalAiSigningBytes } from './security/ai-signing-bytes'
import { replyDraftingV2BindingSchema } from './reply-drafting-v2-binding'
