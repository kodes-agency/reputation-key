import { createHash, sign, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { aiInternalSafeIdSchema } from './ai-internal-transport-contract'
import {
  OPENAI_MODEL_SNAPSHOT,
  OPENAI_PROMPT_VERSIONS,
} from './ai-openai-request-contract'

const DOMAIN = 'repkey-ai-reply-provenance-v1\0'
const TOKEN_PREFIX = 'rk_ai_reply_v1'
const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const safeId = aiInternalSafeIdSchema
const positive = z.number().int().positive().safe()
const nonnegative = z.number().int().nonnegative().safe()

const payloadSchema = z
  .object({
    version: z.literal('ai-reply-provenance-v1'),
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
    modelSnapshot: z.literal(OPENAI_MODEL_SNAPSHOT),
    promptVersion: z.literal(OPENAI_PROMPT_VERSIONS['reply-suggestion']),
    outputLeakageProfileVersion: safeId,
    outputLeakageProfileDigest: digest,
    replyTemplateCatalogueVersion: safeId,
    replyTemplateCatalogueDigest: digest,
    templateId: z.enum([
      'appreciation_positive',
      'appreciation_neutral',
      'recovery_service',
      'acknowledge_concern',
    ]),
    concreteLanguageTag: safeId,
    templateGroup: safeId,
    renderedSuggestionDigest: digest,
    tokenExpiresAtEpochMillis: positive,
    draftExpiresAtEpochMillis: positive,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.tokenExpiresAtEpochMillis > value.draftExpiresAtEpochMillis) {
      context.addIssue({ code: 'custom', message: 'token expiry exceeds draft expiry' })
    }
  })

export type AiReplyProvenancePayloadV1 = z.infer<typeof payloadSchema>

function signingBytes(canonicalPayload: string): Buffer {
  return Buffer.from(`${DOMAIN}${canonicalPayload}`, 'utf8')
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
  rawPayload: AiReplyProvenancePayloadV1,
  privateKey: KeyObject,
): string {
  const payload = payloadSchema.parse(rawPayload)
  const canonicalPayload = canonicalizeRfc8785(payload)
  let payloadBytes: Buffer | null = null
  let signatureBytes: Buffer | null = null
  let bytes: Buffer | null = null
  try {
    payloadBytes = Buffer.from(canonicalPayload, 'utf8')
    bytes = signingBytes(canonicalPayload)
    signatureBytes = sign(null, bytes, privateKey)
    if (signatureBytes.byteLength !== 64) {
      throw new TypeError('AI reply provenance signature is invalid')
    }
    return `${TOKEN_PREFIX}.${payloadBytes.toString('base64url')}.${signatureBytes.toString('base64url')}`
  } finally {
    payloadBytes?.fill(0)
    signatureBytes?.fill(0)
    bytes?.fill(0)
  }
}

export function verifyAiReplyProvenance(
  token: string,
  publicKeys: ReadonlyMap<string, KeyObject>,
): AiReplyProvenancePayloadV1 | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
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
    const canonicalPayload = canonicalizeRfc8785(payload)
    canonicalPayloadBytes = Buffer.from(canonicalPayload, 'utf8')
    if (canonicalPayloadBytes.toString('base64url') !== parts[1]) return null
    const key = publicKeys.get(payload.kid)
    if (!key) return null
    bytes = signingBytes(canonicalPayload)
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
