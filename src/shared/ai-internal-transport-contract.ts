import { sign, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import type { VersionedHmacKeyring } from './security/versioned-hmac-keyring'

export const AI_REVIEW_ROUTE_MAX_BYTES = 65_536 as const
export const AI_TREND_ROUTE_MAX_BYTES = 131_072 as const
export const AI_AUTHORIZE_MAX_BYTES = 65_536 as const
export const AI_SETTLE_MAX_BYTES = 16_384 as const
export const AI_INTERNAL_RESPONSE_MAX_BYTES = 65_536 as const

const REQUEST_BINDING_AUDIENCE = 'ai-request-binding-v1'
const GRANT_DOMAIN = 'ai-execution-grant-v1\0'
const RECEIPT_DOMAIN = 'ai-settlement-receipt-v1\0'
const INTERNAL_ERROR = 'AI internal request is invalid'
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/
const KEY_ID = /^[a-z][a-z0-9_-]{0,31}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/
const RELEASE_SHA = /^[0-9a-f]{40}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/
const HMAC = /^[A-Za-z0-9_-]{43}$/

export const AI_INTERNAL_JSON_MAX_DEPTH = 64 as const
export const AI_INTERNAL_JSON_MAX_NODES = 10_000 as const

function fail(): never {
  throw new TypeError(INTERNAL_ERROR)
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

/**
 * `safe-integers` is the internal-transport invariant: our own services encode
 * every number as a safe integer, so anything fractional is a defect or an
 * injection. `finite-numbers` is for third-party provider bodies, which
 * legitimately echo fractional sampling parameters such as `top_p`.
 */
export type AiJsonNumberPolicy = 'safe-integers' | 'finite-numbers'

function validateParsedJson(value: unknown, numbers: AiJsonNumberPolicy): void {
  let nodeCount = 0
  const visit = (entry: unknown, depth: number): void => {
    nodeCount += 1
    if (depth > AI_INTERNAL_JSON_MAX_DEPTH || nodeCount > AI_INTERNAL_JSON_MAX_NODES) {
      fail()
    }
    if (typeof entry === 'string') {
      if (!hasOnlyUnicodeScalars(entry)) fail()
      return
    }
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) fail()
      if (numbers === 'safe-integers' && !Number.isSafeInteger(entry)) fail()
      return
    }
    if (entry === null || typeof entry === 'boolean') return
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child, depth + 1)
      return
    }
    if (typeof entry !== 'object' || Object.getPrototypeOf(entry) !== Object.prototype) {
      fail()
    }
    for (const [key, child] of Object.entries(entry)) {
      if (!hasOnlyUnicodeScalars(key)) fail()
      visit(child, depth + 1)
    }
  }
  visit(value, 1)
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20
}

function scanJsonNumber(raw: string, start: number): number | null {
  let cursor = start
  if (raw.charCodeAt(cursor) === 0x2d) cursor += 1
  const integerStart = cursor
  const first = raw.charCodeAt(cursor)
  if (first === 0x30) {
    cursor += 1
  } else if (first >= 0x31 && first <= 0x39) {
    cursor += 1
    while (raw.charCodeAt(cursor) >= 0x30 && raw.charCodeAt(cursor) <= 0x39) cursor += 1
  } else {
    return null
  }
  if (cursor === integerStart) return null
  if (raw.charCodeAt(cursor) === 0x2e) {
    cursor += 1
    const fractionStart = cursor
    while (raw.charCodeAt(cursor) >= 0x30 && raw.charCodeAt(cursor) <= 0x39) cursor += 1
    if (cursor === fractionStart) return null
  }
  const exponent = raw.charCodeAt(cursor)
  if (exponent === 0x45 || exponent === 0x65) {
    cursor += 1
    const sign = raw.charCodeAt(cursor)
    if (sign === 0x2b || sign === 0x2d) cursor += 1
    const exponentStart = cursor
    while (raw.charCodeAt(cursor) >= 0x30 && raw.charCodeAt(cursor) <= 0x39) cursor += 1
    if (cursor === exponentStart) return null
  }
  return cursor
}

export function isApplicationJsonUtf8(value: string): boolean {
  const normalized = value.toLowerCase()
  const mediaType = 'application/json'
  if (!normalized.startsWith(mediaType)) return false
  let cursor = mediaType.length
  while (normalized[cursor] === ' ' || normalized[cursor] === '\t') cursor += 1
  if (cursor === normalized.length) return true
  if (normalized[cursor] !== ';') return false
  cursor += 1
  while (normalized[cursor] === ' ' || normalized[cursor] === '\t') cursor += 1
  const parameter = 'charset'
  if (normalized.slice(cursor, cursor + parameter.length) !== parameter) return false
  cursor += parameter.length
  while (normalized[cursor] === ' ' || normalized[cursor] === '\t') cursor += 1
  if (normalized[cursor] !== '=') return false
  cursor += 1
  while (normalized[cursor] === ' ' || normalized[cursor] === '\t') cursor += 1
  const charset = 'utf-8'
  if (normalized.slice(cursor, cursor + charset.length) !== charset) return false
  cursor += charset.length
  while (normalized[cursor] === ' ' || normalized[cursor] === '\t') cursor += 1
  return cursor === normalized.length
}

function scanStrictJson(raw: string): void {
  let offset = 0
  let nodeCount = 0
  const skipWhitespace = () => {
    while (offset < raw.length && isJsonWhitespace(raw.charCodeAt(offset))) offset += 1
  }
  const scanString = (): string => {
    const start = offset
    if (raw[offset] !== '"') fail()
    offset += 1
    while (offset < raw.length) {
      const code = raw.charCodeAt(offset)
      if (code === 0x22) {
        offset += 1
        try {
          const value = JSON.parse(raw.slice(start, offset)) as unknown
          if (typeof value !== 'string' || !hasOnlyUnicodeScalars(value)) fail()
          return value
        } catch {
          fail()
        }
      }
      if (code < 0x20) fail()
      if (code === 0x5c) {
        offset += 1
        const escape = raw[offset]
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(raw.slice(offset + 1, offset + 5))) fail()
          offset += 5
          continue
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) fail()
      }
      offset += 1
    }
    fail()
  }
  const scanValue = (depth: number): void => {
    nodeCount += 1
    if (depth > AI_INTERNAL_JSON_MAX_DEPTH || nodeCount > AI_INTERNAL_JSON_MAX_NODES) {
      fail()
    }
    skipWhitespace()
    const token = raw.charCodeAt(offset)
    // JSON syntax bytes are public input, not secrets requiring constant-time comparison.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (token === 0x22) {
      scanString()
      return
    }
    // JSON syntax bytes are public input, not secrets requiring constant-time comparison.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (token === 0x7b) {
      offset += 1
      skipWhitespace()
      const keys = new Set<string>()
      if (raw.charCodeAt(offset) === 0x7d) {
        offset += 1
        return
      }
      while (offset < raw.length) {
        skipWhitespace()
        const key = scanString()
        if (keys.has(key)) fail()
        keys.add(key)
        skipWhitespace()
        if (raw.charCodeAt(offset) !== 0x3a) fail()
        offset += 1
        scanValue(depth + 1)
        skipWhitespace()
        if (raw.charCodeAt(offset) === 0x7d) {
          offset += 1
          return
        }
        if (raw.charCodeAt(offset) !== 0x2c) fail()
        offset += 1
      }
      fail()
    }
    // JSON syntax bytes are public input, not secrets requiring constant-time comparison.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (token === 0x5b) {
      offset += 1
      skipWhitespace()
      if (raw.charCodeAt(offset) === 0x5d) {
        offset += 1
        return
      }
      while (offset < raw.length) {
        scanValue(depth + 1)
        skipWhitespace()
        if (raw.charCodeAt(offset) === 0x5d) {
          offset += 1
          return
        }
        if (raw.charCodeAt(offset) !== 0x2c) fail()
        offset += 1
      }
      fail()
    }
    let literalLength = 0
    if (raw.startsWith('true', offset) || raw.startsWith('null', offset)) {
      literalLength = 4
    } else if (raw.startsWith('false', offset)) {
      literalLength = 5
    }
    if (literalLength > 0) {
      offset += literalLength
      return
    }
    const numberEnd = scanJsonNumber(raw, offset)
    if (numberEnd !== null) {
      offset = numberEnd
      return
    }
    fail()
  }
  scanValue(1)
  skipWhitespace()
  if (offset !== raw.length) fail()
}

export function parseStrictInternalJsonBytes<T>(
  bytes: Uint8Array,
  maxBytes: number,
  schema: z.ZodType<T>,
  numbers: AiJsonNumberPolicy = 'safe-integers',
): T {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 8 * 1024 * 1024 ||
    bytes.byteLength < 1 ||
    bytes.byteLength > maxBytes ||
    (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) {
    fail()
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    scanStrictJson(raw)
    const value = JSON.parse(raw) as unknown
    validateParsedJson(value, numbers)
    return schema.parse(value)
  } catch {
    fail()
  }
}

/**
 * Diagnostic twin of `parseStrictInternalJsonBytes`: names the first rule the
 * bytes violate and the JSON path that violates it, instead of the opaque
 * `fail()`. Operator and canary diagnostics only — never on a caller path.
 */
export function explainJsonBytesRejection(
  bytes: Uint8Array,
  maxBytes: number,
  numbers: AiJsonNumberPolicy = 'safe-integers',
): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) {
    return `max_bytes:${maxBytes}`
  }
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    return `byte_length:${bytes.byteLength}`
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return 'bom'
  }
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return 'utf8'
  }
  let scan = 'scan:ok'
  try {
    scanStrictJson(raw)
  } catch {
    scan = 'scan:fail'
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return `${scan};parse:fail`
  }
  let violation = 'ok'
  let nodeCount = 0
  const visit = (entry: unknown, depth: number, path: string): boolean => {
    nodeCount += 1
    if (depth > AI_INTERNAL_JSON_MAX_DEPTH) {
      violation = `depth:${path}`
      return false
    }
    if (nodeCount > AI_INTERNAL_JSON_MAX_NODES) {
      violation = `nodes:${path}`
      return false
    }
    if (typeof entry === 'string') {
      if (!hasOnlyUnicodeScalars(entry)) violation = `string_surrogate:${path}`
      return violation === 'ok'
    }
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) violation = `number_not_finite:${path}`
      else if (numbers === 'safe-integers' && !Number.isSafeInteger(entry)) {
        violation = `number_not_integer:${path}=${String(entry)}`
      }
      return violation === 'ok'
    }
    if (entry === null || typeof entry === 'boolean') return true
    if (Array.isArray(entry)) {
      for (const [index, child] of entry.entries()) {
        if (!visit(child, depth + 1, `${path}[${index}]`)) return false
      }
      return true
    }
    if (typeof entry !== 'object' || Object.getPrototypeOf(entry) !== Object.prototype) {
      violation = `prototype:${path}`
      return false
    }
    for (const [key, child] of Object.entries(entry)) {
      if (!hasOnlyUnicodeScalars(key)) {
        violation = `key_surrogate:${path}.${key.length}ch`
        return false
      }
      if (!visit(child, depth + 1, `${path}.${key}`)) return false
    }
    return true
  }
  visit(parsed, 1, '$')
  return `${scan};parse:ok;validate:${violation};nodes:${nodeCount}`
}

export function parseAiInternalJsonBytes<T>(
  bytes: Uint8Array,
  maxBytes: number,
  schema: z.ZodType<T>,
): T {
  if (maxBytes > AI_TREND_ROUTE_MAX_BYTES) fail()
  return parseStrictInternalJsonBytes(bytes, maxBytes, schema)
}

/**
 * Provider response bodies get every internal rule — byte cap, fatal UTF-8, no
 * BOM, strict scan, no duplicate keys, depth and node caps, unicode scalars —
 * except integers-only: a provider legitimately echoes fractional sampling
 * parameters (`top_p`), and rejecting those turned a valid 200 into
 * `output_invalid`.
 */
export function parseAiProviderJsonBytes<T>(
  bytes: Uint8Array,
  maxBytes: number,
  schema: z.ZodType<T>,
): T {
  if (maxBytes > AI_TREND_ROUTE_MAX_BYTES) fail()
  return parseStrictInternalJsonBytes(bytes, maxBytes, schema, 'finite-numbers')
}

async function cancelBodyQuietly(body: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await body.cancel()
  } catch {
    // Cleanup failure must never replace the closed transport denial.
  }
}

async function cancelReaderQuietly(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // Cleanup failure must never replace the closed transport denial.
  }
}

export async function readAiInternalJsonRequest<T>(
  request: Request,
  maxBytes: number,
  schema: z.ZodType<T>,
): Promise<T> {
  const contentType = request.headers.get('content-type')
  const contentLength = request.headers.get('content-length')
  const body = request.body
  if (
    contentType === null ||
    !isApplicationJsonUtf8(contentType) ||
    request.headers.has('content-encoding') ||
    (contentLength !== null &&
      (!/^(0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > maxBytes)) ||
    body === null
  ) {
    if (body !== null) await cancelBodyQuietly(body)
    fail()
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let combinedBytes: Uint8Array | null = null
  let readerDone = false
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        readerDone = true
        break
      }
      chunks.push(next.value)
      totalBytes += next.value.byteLength
      if (totalBytes > maxBytes) fail()
    }
    if (contentLength !== null && Number(contentLength) !== totalBytes) fail()
    combinedBytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      combinedBytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return parseAiInternalJsonBytes(combinedBytes, maxBytes, schema)
  } catch (error) {
    if (!readerDone) await cancelReaderQuietly(reader)
    throw error
  } finally {
    combinedBytes?.fill(0)
    for (const chunk of chunks) chunk.fill(0)
    reader.releaseLock()
  }
}

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
  z
    .object({
      capability: z.literal('property_trends'),
      reviewAnalysisEpoch: positive,
      propertyTrendsEpoch: positive,
    })
    .strict(),
])

const concreteLanguageSchema = z.object({ tag: safeId, templateGroup: safeId }).strict()

export const aiExecutionBindingSchema = z
  .object({
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
    capability: z.enum(['review_analysis', 'reply_drafting', 'property_trends']),
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
            canaryStopFenceEntrySchema.extend({
              capability: z.literal('property_trends'),
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
const propertyTrendDescriptorSchema = z
  .object({
    ...propertyDescriptorShape,
    route: z.literal('property-trend'),
    actorId: z.null(),
    observedContentExpiresAtEpochMillis: z.null(),
    redactionCountry: z.null(),
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

export const aiAdmissionDescriptorSchema = z
  .discriminatedUnion('route', [
    reviewAnalysisDescriptorSchema,
    replySuggestionDescriptorSchema,
    propertyTrendDescriptorSchema,
    canaryDescriptorSchema,
  ])
  .superRefine((value, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message })
    if (
      value.sourceByteCount > value.limits.sourceBytes ||
      value.providerPayloadByteCount > value.limits.providerPayloadBytes ||
      value.preparedByteCount > value.limits.preparedRequestBytes
    ) {
      issue('descriptor byte count exceeds its limit')
    }
    if (value.route === 'synthetic-canary') {
      if (
        value.releaseSha !== value.canaryBinding.releaseSha ||
        value.canaryAuthorizationId !== value.canaryBinding.canaryAuthorizationId ||
        value.promptCacheShard !== 0
      ) {
        issue('canary descriptor binding is inconsistent')
      }
      return
    }
    if (
      value.redactionProfileVersion !== value.binding.redactionProfileVersion ||
      value.outputLeakageProfileVersion !== value.binding.outputLeakageProfileVersion ||
      value.outputLeakageProfileDigest !== value.binding.outputLeakageProfileDigest ||
      value.replyTemplateCatalogueVersion !==
        value.binding.replyTemplateCatalogueVersion ||
      value.replyTemplateCatalogueDigest !== value.binding.replyTemplateCatalogueDigest
    ) {
      issue('property descriptor profile binding is inconsistent')
    }
    const capability = value.binding.capabilityFence.capability
    if (
      (value.route === 'review-analysis' && capability !== 'review_analysis') ||
      (value.route === 'reply-suggestion' && capability !== 'reply_drafting') ||
      (value.route === 'property-trend' && capability !== 'property_trends')
    ) {
      issue('descriptor route and capability are inconsistent')
    }
    if (value.route === 'reply-suggestion') {
      if (
        value.binding.concreteReplyLanguage === null ||
        value.outputLeakageProfileVersion === null ||
        value.outputLeakageProfileDigest === null ||
        value.replyTemplateCatalogueVersion === null ||
        value.replyTemplateCatalogueDigest === null
      ) {
        issue('reply descriptor requires output profiles')
      }
    } else if (
      value.binding.concreteReplyLanguage !== null ||
      value.outputLeakageProfileVersion !== null ||
      value.outputLeakageProfileDigest !== null ||
      value.replyTemplateCatalogueVersion !== null ||
      value.replyTemplateCatalogueDigest !== null
    ) {
      issue('non-reply descriptor forbids reply output profiles')
    }
  })

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
    route: z.enum([
      'review-analysis',
      'reply-suggestion',
      'property-trend',
      'synthetic-canary',
    ]),
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

export const AI_PROVIDER_DISPOSITIONS = [
  'success',
  'no_dispatch',
  'provider_refused',
  'output_invalid',
  'rate_limited',
  'provider_unavailable',
  'caller_aborted',
  'deadline_exceeded',
  'transport_ambiguous',
  'source_stale',
  'policy_denied',
] as const
export const AI_GATEWAY_REPORTED_DISPOSITIONS = [
  'success',
  'no_dispatch',
  'provider_refused',
  'output_invalid',
  'rate_limited',
  'provider_unavailable',
  'caller_aborted',
  'deadline_exceeded',
  'transport_ambiguous',
] as const
function validateReceiptUsage(
  value: {
    disposition: (typeof AI_PROVIDER_DISPOSITIONS)[number]
    reportedDisposition: (typeof AI_GATEWAY_REPORTED_DISPOSITIONS)[number]
    usageKnown: boolean
    providerRetryable: boolean
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningTokens: number
    costMicros: number
    settlementState: 'settled' | 'released' | 'ambiguous'
  },
  context: z.RefinementCtx,
): void {
  if (
    value.cachedInputTokens > value.inputTokens ||
    value.reasoningTokens > value.outputTokens ||
    (!value.usageKnown &&
      (value.inputTokens !== 0 ||
        value.cachedInputTokens !== 0 ||
        value.outputTokens !== 0 ||
        value.reasoningTokens !== 0)) ||
    (value.disposition === 'success' && !value.usageKnown) ||
    (value.providerRetryable &&
      (value.disposition !== value.reportedDisposition ||
        (value.reportedDisposition !== 'rate_limited' &&
          value.reportedDisposition !== 'provider_unavailable'))) ||
    (value.reportedDisposition === 'rate_limited' &&
      value.disposition === value.reportedDisposition &&
      !value.providerRetryable) ||
    value.settlementState !==
      (value.disposition === 'no_dispatch'
        ? 'released'
        : value.disposition === 'transport_ambiguous'
          ? 'ambiguous'
          : 'settled') ||
    (value.disposition === 'no_dispatch' && (value.usageKnown || value.costMicros !== 0))
  ) {
    context.addIssue({ code: 'custom', message: 'receipt usage is inconsistent' })
  }
}

const receiptBaseSchema = z
  .object({
    version: z.literal('ai-settlement-receipt-v1'),
    receiptKid: keyId,
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
const unsignedReceiptSchema = receiptBaseSchema.superRefine(validateReceiptUsage)
const receiptSchema = receiptBaseSchema
  .extend({ receiptSignature: signature })
  .strict()
  .superRefine(validateReceiptUsage)
export const aiSettlementReceiptSchema = receiptSchema
export type AiSettlementReceiptUnsignedV1 = z.infer<typeof unsignedReceiptSchema>
export type AiSettlementReceiptV1 = z.infer<typeof receiptSchema>

function canonicalBytes(domain: string, value: unknown): Buffer {
  return Buffer.from(`${domain}${canonicalizeRfc8785(value)}`, 'utf8')
}

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
  const canonical = canonicalBytes(GRANT_DOMAIN, parsed)
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
  const canonical = canonicalBytes(GRANT_DOMAIN, unsigned)
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

export function signAiSettlementReceipt(
  unsigned: AiSettlementReceiptUnsignedV1,
  privateKey: KeyObject,
): AiSettlementReceiptV1 {
  const parsed = unsignedReceiptSchema.parse(unsigned)
  const canonical = canonicalBytes(RECEIPT_DOMAIN, parsed)
  let signature: Buffer | null = null
  try {
    signature = sign(null, canonical, privateKey)
    return receiptSchema.parse({
      ...parsed,
      receiptSignature: signature.toString('base64url'),
    })
  } finally {
    canonical.fill(0)
    signature?.fill(0)
  }
}

export function verifyAiSettlementReceipt(
  receipt: AiSettlementReceiptV1,
  publicKeys: ReadonlyMap<string, KeyObject>,
): boolean {
  const parsed = receiptSchema.safeParse(receipt)
  if (!parsed.success) return false
  const { receiptSignature, ...unsigned } = parsed.data
  const key = publicKeys.get(unsigned.receiptKid)
  if (key === undefined) return false
  const canonical = canonicalBytes(RECEIPT_DOMAIN, unsigned)
  const signature = Buffer.from(receiptSignature, 'base64url')
  try {
    return verify(null, canonical, key, signature)
  } finally {
    canonical.fill(0)
    signature.fill(0)
  }
}

export const aiAdmissionRequestSchema = admissionRequestSchema
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
      value.cachedInputTokens > value.inputTokens ||
      value.reasoningTokens > value.outputTokens ||
      (!value.usageKnown &&
        (value.inputTokens !== 0 ||
          value.cachedInputTokens !== 0 ||
          value.outputTokens !== 0 ||
          value.reasoningTokens !== 0)) ||
      (value.disposition === 'success' && !value.usageKnown) ||
      (value.providerRetryable &&
        (value.disposition !== value.reportedDisposition ||
          (value.reportedDisposition !== 'rate_limited' &&
            value.reportedDisposition !== 'provider_unavailable'))) ||
      (value.reportedDisposition === 'rate_limited' &&
        value.disposition === value.reportedDisposition &&
        !value.providerRetryable) ||
      (value.disposition === 'no_dispatch' &&
        (value.usageKnown ||
          value.inputTokens !== 0 ||
          value.cachedInputTokens !== 0 ||
          value.outputTokens !== 0 ||
          value.reasoningTokens !== 0 ||
          value.retryAfterSeconds !== null)) ||
      (value.retryAfterSeconds !== null && !value.providerRetryable)
    ) {
      context.addIssue({ code: 'custom', message: 'settlement usage is inconsistent' })
    }
  })
export type AiSettlementRequestV1 = z.infer<typeof aiSettlementRequestSchema>
