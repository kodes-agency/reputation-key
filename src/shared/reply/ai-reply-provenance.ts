import {
  REPLY_DRAFTING_V2_VERSIONS,
  REPLY_DRAFTING_V2_LANGUAGES,
} from '#/shared/reply/schema'
import { replyVoiceChoicesSchema } from './reply-drafting-v2-binding'
import { createHash, sign, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from '#/shared/json/canonical-json'
import { aiInternalSafeIdSchema } from '../ai-gateway/ai-internal-transport-contract'
import { OPENAI_MODEL_SNAPSHOT } from '../ai-provider-profile/ai-openai-request-contract'

const DOMAIN = 'repkey-ai-reply-provenance-v4\0'
const TOKEN_PREFIX = 'rk_ai_reply_v4'
// Append each issuing policy's immutable digest here. Keep prior pins for at
// least the adoption window after their last issuing process stops. Signature,
// expiry and transactional adoption fences still apply; removing a pin
// deliberately revokes its browser-held suggestions.
const SUPPORTED_SENTENCE_REPLY_PROFILE_DIGESTS: readonly string[] = Object.freeze([
  'f7a7277c2a255a59284d8b17131e39a6c1a4f82c1f8490d0db1c51d6f5c7ccfe',
])
const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const safeId = aiInternalSafeIdSchema
const positive = z.number().int().positive().safe()
const nonnegative = z.number().int().nonnegative().safe()

// A token names the execution permit and attempt that delivered it; the
// strict object rejects any other binding field.
const executionPermitBindingShape = {
  executionPermitId: canonicalUuid,
  executionAttempt: positive,
} as const

function withExecutionBinding<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object({ ...shape, ...executionPermitBindingShape }).strict()
}

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

const payloadSchema = withExecutionBinding({
  version: z.literal(REPLY_DRAFTING_V2_VERSIONS.provenance),
  kid: z.string().regex(/^[a-z][a-z0-9._-]{0,31}$/),
  operationId: canonicalUuid,
  actorId: safeId,
  organizationId: safeId,
  propertyId: canonicalUuid,
  reviewId: safeId,
  // 0-based source epoch (drizzle/0060); the versions below stay 1-based.
  sourceEpoch: nonnegative,
  sourceRevision: positive,
  baseReplyStateRevision: nonnegative,
  replyDraftingEpoch: positive,
  propertyProfileVersion: positive,
  providerDeploymentProfileVersion: safeId,
  operationProfileVersion: z.literal(REPLY_DRAFTING_V2_VERSIONS.operation),
  modelSnapshot: z.literal(OPENAI_MODEL_SNAPSHOT),
  promptVersion: z.literal(REPLY_DRAFTING_V2_VERSIONS.prompt),
  outputLeakageProfileVersion: safeId,
  outputLeakageProfileDigest: digest,
  concreteLanguageTag: safeId,
  templateGroup: safeId,
  renderedSuggestionDigest: digest,
  tokenExpiresAtEpochMillis: positive,
  draftExpiresAtEpochMillis: positive,
  replyProfileVersion: z.literal(REPLY_DRAFTING_V2_VERSIONS.profile),
  replyProfileDigest: z.enum(SUPPORTED_SENTENCE_REPLY_PROFILE_DIGESTS),
  replyBrandProfileVersion: positive,
  replyBrandDisplayNameDigest: digest,
  replyVoiceDigest: digest,
  voiceChoices: replyVoiceChoicesSchema,
  parentOperationId: canonicalUuid.nullable(),
  rewriteOrdinal: z.union([z.literal(0), z.literal(1)]),
}).superRefine((value, context) => {
  expiryRefinement(value, context)
  const group = REPLY_DRAFTING_V2_LANGUAGES.find((tag) => tag === value.templateGroup)
  if (
    !group ||
    (value.concreteLanguageTag !== group &&
      !value.concreteLanguageTag.startsWith(`${group}-`))
  )
    context.addIssue({ code: 'custom', message: 'Unapproved v2 reply language' })
  if ((value.parentOperationId === null) !== (value.rewriteOrdinal === 0))
    context.addIssue({ code: 'custom', message: 'Invalid rewrite lineage' })
})

export type AiReplyProvenancePayload = z.infer<typeof payloadSchema>

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

/**
 * How long an issued reply suggestion stays adoptable in the browser.
 *
 * This is a human window, not a machine one. It used to be the route's
 * `callerDeadlineEpochMillis` - the provider *request* deadline (70 s, of which
 * inference spends 5-20 s) - so a manager who read the draft for a minute got
 * "The suggested draft could not be saved" and lost it. Every other fence on
 * adoption is state-based, not time-based: single-use `replyAdoptionDisposition`
 * CAS, the rendered-suggestion digest, and the source/reply/profile revisions
 * checked inside the accepting transaction (see
 * `src/contexts/reputation/replies/ai-suggested-draft-store.server.ts`), which turn
 * a genuinely stale suggestion into `stale`, not `expired`. The window is
 * therefore free to be generous, and is bounded by the operation row's own
 * 15-minute `expires_at` where the attempt is admitted.
 */
export const AI_REPLY_ADOPTION_WINDOW_MILLIS = 10 * 60 * 1_000

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
): AiReplyProvenancePayload | null {
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
