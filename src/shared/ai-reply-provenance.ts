import { createHash, sign, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { aiInternalSafeIdSchema } from './ai-internal-transport-contract'
import {
  OPENAI_KNOWN_MODEL_SNAPSHOTS,
  OPENAI_PROMPT_VERSIONS,
} from './ai-openai-request-contract'
import {
  AI_PERSONALIZED_REPLY_LANGUAGES,
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from './ai-personalized-reply-contract'

const DOMAINS = Object.freeze({
  'ai-reply-provenance-v1': 'repkey-ai-reply-provenance-v1\0',
  'ai-reply-provenance-v2': 'repkey-ai-reply-provenance-v2\0',
  'ai-reply-provenance-v3': 'repkey-ai-reply-provenance-v3\0',
})
const TOKEN_PREFIXES = Object.freeze({
  'ai-reply-provenance-v1': 'rk_ai_reply_v1',
  'ai-reply-provenance-v2': 'rk_ai_reply_v2',
  'ai-reply-provenance-v3': 'rk_ai_reply_v3',
})
// Preserve the exact V2 profile pin. V2 predates public Property Brand
// Profile grounding and must not silently inherit the active V3 profile.
const LEGACY_PERSONALIZED_REPLY_PROFILE_VERSION = 'reply-draft-v1'
const LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST =
  '86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769'
const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const safeId = aiInternalSafeIdSchema
const positive = z.number().int().positive().safe()
const nonnegative = z.number().int().nonnegative().safe()

const commonPayloadShape = {
  kid: z.string().regex(/^[a-z][a-z0-9._-]{0,31}$/),
  operationId: canonicalUuid,
  actorId: safeId,
  organizationId: safeId,
  propertyId: canonicalUuid,
  reviewId: safeId,
  requestBindingHmac: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  // 0-based source epoch (drizzle/0060); the versions below stay 1-based.
  sourceEpoch: nonnegative,
  sourceRevision: positive,
  baseReplyStateRevision: nonnegative,
  replyDraftingEpoch: positive,
  propertyProfileVersion: positive,
  providerDeploymentProfileVersion: safeId,
  operationProfileVersion: z.literal('reply-suggestion-v1'),
  // Known-version set, not a literal: stored provenance stays verifiable at the
  // snapshot it was signed under. See OPENAI_KNOWN_MODEL_SNAPSHOTS.
  modelSnapshot: z.enum(OPENAI_KNOWN_MODEL_SNAPSHOTS),
  promptVersion: z.literal(OPENAI_PROMPT_VERSIONS['reply-suggestion']),
  outputLeakageProfileVersion: safeId,
  outputLeakageProfileDigest: digest,
  concreteLanguageTag: safeId,
  templateGroup: safeId,
  renderedSuggestionDigest: digest,
  tokenExpiresAtEpochMillis: positive,
  draftExpiresAtEpochMillis: positive,
} as const

const expiryRefinement = (
  value: Readonly<{
    tokenExpiresAtEpochMillis: number
    draftExpiresAtEpochMillis: number
  }>,
  context: z.RefinementCtx,
): void => {
  if (value.tokenExpiresAtEpochMillis > value.draftExpiresAtEpochMillis) {
    context.addIssue({ code: 'custom', message: 'token expiry exceeds draft expiry' })
  }
}

const personalizedRefinement = (
  value: Readonly<{
    tokenExpiresAtEpochMillis: number
    draftExpiresAtEpochMillis: number
    concreteLanguageTag: string
    templateGroup: string
  }>,
  context: z.RefinementCtx,
): void => {
  expiryRefinement(value, context)
  if (
    !AI_PERSONALIZED_REPLY_LANGUAGES.some(
      (language) => language === value.templateGroup,
    ) ||
    (value.concreteLanguageTag !== value.templateGroup &&
      !value.concreteLanguageTag.startsWith(`${value.templateGroup}-`))
  ) {
    context.addIssue({
      code: 'custom',
      message: 'personalized reply language is not approved',
    })
  }
}

const legacyPayloadSchema = z
  .object({
    version: z.literal('ai-reply-provenance-v1'),
    ...commonPayloadShape,
    replyTemplateCatalogueVersion: safeId,
    replyTemplateCatalogueDigest: digest,
    templateId: z.enum([
      'appreciation_positive',
      'appreciation_neutral',
      'recovery_service',
      'acknowledge_concern',
    ]),
  })
  .strict()
  .superRefine(expiryRefinement)

const personalizedPayloadSchema = z
  .object({
    version: z.literal('ai-reply-provenance-v2'),
    ...commonPayloadShape,
    replyProfileVersion: z.literal(LEGACY_PERSONALIZED_REPLY_PROFILE_VERSION),
    replyProfileDigest: z.literal(LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST),
  })
  .strict()
  .superRefine(personalizedRefinement)

const groundedPersonalizedPayloadSchema = z
  .object({
    version: z.literal('ai-reply-provenance-v3'),
    ...commonPayloadShape,
    replyProfileVersion: z.literal(AI_PERSONALIZED_REPLY_PROFILE_VERSION),
    replyProfileDigest: z.literal(AI_PERSONALIZED_REPLY_PROFILE_DIGEST),
    replyBrandProfileVersion: positive,
    replyBrandDisplayNameDigest: digest,
  })
  .strict()
  .superRefine(personalizedRefinement)

const payloadSchema = z.union([
  legacyPayloadSchema,
  personalizedPayloadSchema,
  groundedPersonalizedPayloadSchema,
])

export type AiReplyProvenancePayloadV1 = z.infer<typeof legacyPayloadSchema>
export type AiReplyProvenancePayloadV2 = z.infer<typeof personalizedPayloadSchema>
export type AiReplyProvenancePayloadV3 = z.infer<typeof groundedPersonalizedPayloadSchema>
export type AiReplyProvenancePayload = z.infer<typeof payloadSchema>

function signingBytes(
  version: AiReplyProvenancePayload['version'],
  canonicalPayload: string,
): Buffer {
  return Buffer.from(`${DOMAINS[version]}${canonicalPayload}`, 'utf8')
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError('AI reply provenance token is invalid')
  }
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.byteLength === 0 || bytes.toString('base64url') !== value) {
    bytes.fill(0)
    throw new TypeError('AI reply provenance token is invalid')
  }
  return bytes
}

export function digestRenderedReply(text: string): string {
  if (text.length === 0 || text.normalize('NFKC') !== text) {
    throw new TypeError('Rendered reply is invalid')
  }
  return createHash('sha256')
    .update('repkey-ai-rendered-reply-v1\0', 'utf8')
    .update(text, 'utf8')
    .digest('hex')
}

export function signAiReplyProvenance(
  rawPayload: AiReplyProvenancePayload,
  privateKey: KeyObject,
): string {
  const payload = payloadSchema.parse(rawPayload)
  const canonicalPayload = canonicalizeRfc8785(payload)
  let payloadBytes: Buffer | null = null
  let signatureBytes: Buffer | null = null
  let bytes: Buffer | null = null
  try {
    payloadBytes = Buffer.from(canonicalPayload, 'utf8')
    bytes = signingBytes(payload.version, canonicalPayload)
    signatureBytes = sign(null, bytes, privateKey)
    if (signatureBytes.byteLength !== 64) {
      throw new TypeError('AI reply provenance signature is invalid')
    }
    return `${TOKEN_PREFIXES[payload.version]}.${payloadBytes.toString('base64url')}.${signatureBytes.toString('base64url')}`
  } finally {
    payloadBytes?.fill(0)
    signatureBytes?.fill(0)
    bytes?.fill(0)
  }
}

export function verifyAiReplyProvenance(
  token: string,
  publicKeys: ReadonlyMap<string, KeyObject>,
): AiReplyProvenancePayload | null {
  const parts = token.split('.')
  if (
    parts.length !== 3 ||
    (parts[0] !== TOKEN_PREFIXES['ai-reply-provenance-v1'] &&
      parts[0] !== TOKEN_PREFIXES['ai-reply-provenance-v2'] &&
      parts[0] !== TOKEN_PREFIXES['ai-reply-provenance-v3'])
  )
    return null
  let payloadBytes: Buffer | null = null
  let signatureBytes: Buffer | null = null
  let bytes: Buffer | null = null
  let canonicalPayloadBytes: Buffer | null = null
  try {
    payloadBytes = decodeCanonicalBase64Url(parts[1]!)
    signatureBytes = decodeCanonicalBase64Url(parts[2]!)
    if (signatureBytes.byteLength !== 64) return null
    const payload = payloadSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes)),
    )
    if (parts[0] !== TOKEN_PREFIXES[payload.version]) return null
    const canonicalPayload = canonicalizeRfc8785(payload)
    canonicalPayloadBytes = Buffer.from(canonicalPayload, 'utf8')
    if (canonicalPayloadBytes.toString('base64url') !== parts[1]) return null
    const key = publicKeys.get(payload.kid)
    if (!key) return null
    bytes = signingBytes(payload.version, canonicalPayload)
    return verify(null, bytes, key, signatureBytes) ? payload : null
  } catch {
    return null
  } finally {
    bytes?.fill(0)
    canonicalPayloadBytes?.fill(0)
    payloadBytes?.fill(0)
    signatureBytes?.fill(0)
  }
}
