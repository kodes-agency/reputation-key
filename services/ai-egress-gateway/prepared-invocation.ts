import { createHash } from 'node:crypto'
import {
  aiAdmissionDescriptorSchema,
  signAiRequestBinding,
  type AiAdmissionDescriptorV1,
} from '../../src/shared/ai-internal-transport-contract'
import { canonicalizeRfc8785 } from '../../src/shared/merchant-ai-notice-contract'
import type { VersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import {
  OPENAI_PROMPT_VERSIONS,
  type AiGatewayRoute,
  type ClosedOpenAiRequest,
} from '../../src/shared/ai-openai-request-contract'
import { assertClosedJsonAndFreeze } from '../../src/shared/closed-json-contract'
export { buildClosedOpenAiRequest } from '../../src/shared/ai-openai-request-contract'

const PREPARED_AI_INVOCATION_BRAND_VALUE = true as const
const preparedAiInvocationBrand: unique symbol = Symbol('PreparedAiInvocation')
export type PreparedAiInvocation = Readonly<{
  descriptor: AiAdmissionDescriptorV1
  requestBindingKeyId: string
  requestBindingHmac: string
  sdkRequest: ClosedOpenAiRequest
  canonicalProviderBytes: Uint8Array
  [preparedAiInvocationBrand]: true
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TOKEN = /^[a-z0-9][a-z0-9._-]*$/
const SOURCE_DOMAIN = 'ai-source-v1\0'
const PREPARED_DOMAIN = 'ai-prepared-v1\0'
const CACHE_DOMAIN = 'ai-cache-shard-v1\0'
const CLIENT_REQUEST_ID_DOMAIN = 'repkey-openai-client-request-id-v1\0'

export type DerivedDescriptorFacts = Pick<
  AiAdmissionDescriptorV1,
  | 'sourceDigest'
  | 'preparedDigest'
  | 'sourceByteCount'
  | 'preparedByteCount'
  | 'providerPayloadByteCount'
  | 'promptCacheShard'
>

function uuidBytes(value: string): Buffer {
  if (!UUID.test(value)) throw new TypeError('Invalid canonical UUID')
  return Buffer.from(value.replaceAll('-', ''), 'hex')
}

function uint16(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new TypeError('Value exceeds uint16')
  }
  const bytes = Buffer.allocUnsafe(2)
  bytes.writeUInt16BE(value)
  return bytes
}

function sha256(domain: string, bytes: Uint8Array): string {
  return createHash('sha256').update(domain, 'utf8').update(bytes).digest('hex')
}

export function computePromptCacheShard(
  input: Readonly<{
    operationId: string
    route: AiGatewayRoute
    promptVersion: string
  }>,
): number {
  if (!TOKEN.test(input.route) || !TOKEN.test(input.promptVersion)) {
    throw new TypeError('Invalid cache shard token')
  }
  const routeBytes = Buffer.from(input.route, 'utf8')
  const promptBytes = Buffer.from(input.promptVersion, 'utf8')
  const digest = createHash('sha256')
    .update(CACHE_DOMAIN, 'utf8')
    .update(uuidBytes(input.operationId))
    .update(uint16(routeBytes.byteLength))
    .update(routeBytes)
    .update(uint16(promptBytes.byteLength))
    .update(promptBytes)
    .digest()
  return digest[31]! & 0x0f
}

export function deriveOpenAiClientRequestId(permitId: string): `rk_ai_${string}` {
  const digest = createHash('sha256')
    .update(CLIENT_REQUEST_ID_DOMAIN, 'utf8')
    .update(uuidBytes(permitId))
    .digest('base64url')
  return `rk_ai_${digest}`
}

export function createPreparedAiInvocation(
  input: Readonly<{
    sourceBytes: Uint8Array
    providerPayload: unknown
    sdkRequest: ClosedOpenAiRequest
    createDescriptor: (facts: DerivedDescriptorFacts) => AiAdmissionDescriptorV1
    requestBindingKeys: VersionedHmacKeyring
    traceStage?: (
      stage:
        | 'source'
        | 'provider_payload'
        | 'prepared_request'
        | 'descriptor'
        | 'request_binding',
    ) => void
  }>,
): PreparedAiInvocation {
  if (input.sourceBytes.byteLength < 1) throw new TypeError('AI source bytes are empty')
  input.traceStage?.('source')
  const sourceDigest = sha256(SOURCE_DOMAIN, input.sourceBytes)
  assertClosedJsonAndFreeze(input.providerPayload, 'Prepared AI value')
  const canonicalProviderPayload = canonicalizeRfc8785(input.providerPayload)
  const providerPayloadBytes = Buffer.from(canonicalProviderPayload, 'utf8')
  let canonicalProviderBytes: Buffer | null = null
  let ownershipTransferred = false
  try {
    if (input.sdkRequest.input[1].content !== canonicalProviderPayload) {
      throw new TypeError(
        'Closed OpenAI request is not derived from its provider payload',
      )
    }
    input.traceStage?.('provider_payload')
    assertClosedJsonAndFreeze(input.sdkRequest, 'Prepared AI value')
    const canonicalRequestBytes = Buffer.from(
      canonicalizeRfc8785(input.sdkRequest),
      'utf8',
    )
    canonicalProviderBytes = canonicalRequestBytes
    const preparedDigest = sha256(PREPARED_DOMAIN, canonicalRequestBytes)
    input.traceStage?.('prepared_request')
    const cacheMatch =
      /^rk:([a-z0-9][a-z0-9._-]*):([a-z0-9][a-z0-9._-]*):(0[0-9a-f])$/u.exec(
        input.sdkRequest.prompt_cache_key,
      )
    if (!cacheMatch) throw new TypeError('OpenAI prompt cache key is invalid')
    const promptCacheShard = Number.parseInt(cacheMatch[3]!, 16)
    const facts: DerivedDescriptorFacts = Object.freeze({
      sourceDigest,
      preparedDigest,
      sourceByteCount: input.sourceBytes.byteLength,
      preparedByteCount: canonicalRequestBytes.byteLength,
      providerPayloadByteCount: providerPayloadBytes.byteLength,
      promptCacheShard,
    })
    const descriptor = aiAdmissionDescriptorSchema.parse(input.createDescriptor(facts))
    for (const [field, expected] of Object.entries(facts)) {
      if (descriptor[field as keyof DerivedDescriptorFacts] !== expected) {
        throw new TypeError(`Prepared AI descriptor changed derived field: ${field}`)
      }
    }
    if (
      facts.sourceByteCount > descriptor.limits.sourceBytes ||
      facts.providerPayloadByteCount > descriptor.limits.providerPayloadBytes ||
      facts.preparedByteCount > descriptor.limits.preparedRequestBytes
    ) {
      throw new TypeError('Prepared AI request exceeds its route profile limits')
    }
    const cacheRoute = cacheMatch[1]!
    const promptVersion = cacheMatch[2]!
    const expectedShard =
      descriptor.route === 'synthetic-canary'
        ? 0
        : computePromptCacheShard({
            operationId: descriptor.operationId,
            route: descriptor.route,
            promptVersion,
          })
    if (
      cacheRoute !== descriptor.route ||
      promptVersion !== OPENAI_PROMPT_VERSIONS[descriptor.route] ||
      promptCacheShard !== expectedShard ||
      descriptor.promptCacheShard !== expectedShard
    ) {
      throw new TypeError('OpenAI prompt cache key does not match the descriptor')
    }
    input.traceStage?.('descriptor')
    const request = signAiRequestBinding(descriptor, input.requestBindingKeys)
    input.traceStage?.('request_binding')
    const invocation: PreparedAiInvocation = Object.freeze({
      descriptor: request.descriptor,
      requestBindingKeyId: request.requestBindingKeyId,
      requestBindingHmac: request.requestBindingHmac,
      sdkRequest: input.sdkRequest,
      canonicalProviderBytes: canonicalRequestBytes,
      [preparedAiInvocationBrand]: PREPARED_AI_INVOCATION_BRAND_VALUE,
    })
    ownershipTransferred = true
    return invocation
  } finally {
    providerPayloadBytes.fill(0)
    if (!ownershipTransferred) canonicalProviderBytes?.fill(0)
  }
}
