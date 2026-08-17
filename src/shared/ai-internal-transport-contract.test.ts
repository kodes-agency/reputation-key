import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createVersionedHmacKeyring } from './security/versioned-hmac-keyring'
import {
  AI_INTERNAL_JSON_MAX_DEPTH,
  AI_INTERNAL_JSON_MAX_NODES,
  AI_INTERNAL_RESPONSE_MAX_BYTES,
  parseAiInternalJsonBytes,
  aiSettlementRequestSchema,
  aiSettlementReceiptSchema,
  parseAiAdmissionRequest,
  parseAiExecutionGrant,
  parseAiSettlementReceipt,
  readAiInternalJsonRequest,
  signAiExecutionGrant,
  signAiSettlementReceipt,
  signAiRequestBinding,
  verifyAiExecutionGrant,
  verifyAiSettlementReceipt,
  verifyAiRequestBinding,
  type AiAdmissionDescriptorV1,
} from './ai-internal-transport-contract'

const UUIDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  permit: '10000000-0000-4000-8000-000000000002',
  property: '10000000-0000-4000-8000-000000000003',
  authorization: '10000000-0000-4000-8000-000000000004',
  lineage: '10000000-0000-4000-8000-000000000005',
  controlGlobal: '10000000-0000-4000-8000-000000000006',
  controlProvider: '10000000-0000-4000-8000-000000000007',
  controlCapability: '10000000-0000-4000-8000-000000000008',
} as const

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function nonCanonicalBase64UrlAlias(value: string): string {
  const index = BASE64URL_ALPHABET.indexOf(value.at(-1)!)
  if (index < 0 || index === BASE64URL_ALPHABET.length - 1) {
    throw new Error('test value cannot be aliased')
  }
  return `${value.slice(0, -1)}${BASE64URL_ALPHABET[index + 1]}`
}
const SHA = 'a'.repeat(64)

function descriptor(): AiAdmissionDescriptorV1 {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'review-analysis',
    operationId: UUIDS.operation,
    permitId: UUIDS.permit,
    attemptNumber: 1,
    organizationId: 'org_01',
    propertyId: UUIDS.property,
    internalSubjectId: 'review_01',
    actorId: null,
    binding: {
      authorizationLineageId: UUIDS.lineage,
      noticeVersion: 'merchant-ai-notice-2026-08-15',
      noticeDigest: SHA,
      capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
      sourceEpoch: 1,
      evaluatedLanguage: 'en-Latn',
      concreteReplyLanguage: null,
      languageCatalogueDigest: SHA,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: 1,
      reviewedAtEpochMillis: 1_780_000_000_000,
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      sourceCanonicalizerDigest: SHA,
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'review-analysis-v1',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
      aiSubjectHmacKeyVersion: 'v1',
      stopFence: {
        globalControlId: UUIDS.controlGlobal,
        globalGeneration: 1,
        providerControlId: UUIDS.controlProvider,
        providerGeneration: 1,
        capabilityControlId: UUIDS.controlCapability,
        capabilityGeneration: 1,
      },
    },
    canaryBinding: null,
    releaseSha: null,
    canaryAuthorizationId: null,
    sourceDigest: SHA,
    preparedDigest: 'b'.repeat(64),
    sourceByteCount: 120,
    preparedByteCount: 400,
    providerPayloadByteCount: 220,
    promptCacheShard: 3,
    limits: {
      sourceBytes: 16_384,
      providerPayloadBytes: 32_768,
      preparedRequestBytes: 65_536,
      responseBytes: 65_536,
      outputTokens: 320,
      costMicros: 10_000,
    },
    callerDeadlineEpochMillis: 1_780_000_070_000,
    observedContentExpiresAtEpochMillis: 1_780_000_600_000,
    redactionCountry: 'US',
    redactionProfileVersion: 'gbp-review-global-v1',
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
  }
}

describe('AI internal raw JSON transport', () => {
  const schema = z
    .object({ nested: z.object({ value: z.number().int().safe() }).strict() })
    .strict()

  it('accepts strict UTF-8 JSON and rejects duplicate, trailing, unsafe, BOM, and invalid-scalar input', () => {
    expect(
      parseAiInternalJsonBytes(
        new TextEncoder().encode('{"nested":{"value":1}}'),
        64,
        schema,
      ),
    ).toEqual({ nested: { value: 1 } })

    for (const raw of [
      '{"nested":{"value":1,"value":2}}',
      '{"nested":{"value":1}} null',
      '{"nested":{"value":9007199254740992}}',
      '{"nested":{"value":"\\ud800"}}',
    ]) {
      expect(() =>
        parseAiInternalJsonBytes(new TextEncoder().encode(raw), 128, schema),
      ).toThrow(/AI internal request is invalid/)
    }
    expect(() =>
      parseAiInternalJsonBytes(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d), 64, schema),
    ).toThrow(/AI internal request is invalid/)
  })

  it('rejects trailing high, mid-string high, and lone low surrogates in raw JSON strings', () => {
    const stringSchema = z.object({ value: z.string() }).strict()
    for (const raw of [
      '{"value":"\\ud800"}',
      '{"value":"before\\ud800after"}',
      '{"value":"\\udc00"}',
    ]) {
      expect(() =>
        parseAiInternalJsonBytes(new TextEncoder().encode(raw), 128, stringSchema),
      ).toThrow(/AI internal request is invalid/)
    }
    expect(
      parseAiInternalJsonBytes(
        new TextEncoder().encode('{"value":"\\ud83d\\ude00"}'),
        128,
        stringSchema,
      ),
    ).toEqual({ value: '😀' })
  })

  it('enforces the decoded-byte cap before parsing', () => {
    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode('{"nested":{"value":1}}'),
        8,
        schema,
      ),
    ).toThrow(/AI internal request is invalid/)
    expect(AI_INTERNAL_RESPONSE_MAX_BYTES).toBe(65_536)
  })

  it('bounds JSON depth at the scanner and parsed-value audit boundary', () => {
    const nested = (depth: number) =>
      `${'{"value":'.repeat(depth - 1)}null${'}'.repeat(depth - 1)}`

    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(nested(AI_INTERNAL_JSON_MAX_DEPTH - 1)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).not.toThrow()
    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(nested(AI_INTERNAL_JSON_MAX_DEPTH)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).not.toThrow()
    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(nested(AI_INTERNAL_JSON_MAX_DEPTH + 1)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).toThrow(/AI internal request is invalid/)
  })

  it('bounds the total JSON value-node count', () => {
    const array = (entries: number) =>
      `[${Array.from({ length: entries }, () => '0').join(',')}]`

    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(array(AI_INTERNAL_JSON_MAX_NODES - 1)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).not.toThrow()
    expect(() =>
      parseAiInternalJsonBytes(
        new TextEncoder().encode(array(AI_INTERNAL_JSON_MAX_NODES)),
        AI_INTERNAL_RESPONSE_MAX_BYTES,
        z.unknown(),
      ),
    ).toThrow(/AI internal request is invalid/)
  })

  it('zeroes every acquired body chunk after success and parse failure', async () => {
    const successChunk = new TextEncoder().encode('{"nested":{"value":1}}')
    const successRequest = new Request('https://internal.invalid/v1/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(successChunk)
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    await expect(readAiInternalJsonRequest(successRequest, 64, schema)).resolves.toEqual({
      nested: { value: 1 },
    })
    expect(successChunk.every((byte) => byte === 0)).toBe(true)

    const invalidChunk = new TextEncoder().encode('{"nested":')
    const invalidRequest = new Request('https://internal.invalid/v1/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(invalidChunk)
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    await expect(readAiInternalJsonRequest(invalidRequest, 64, schema)).rejects.toThrow(
      /AI internal request is invalid/,
    )
    expect(invalidChunk.every((byte) => byte === 0)).toBe(true)
  })

  it('cancels rejected bodies, zeroes the cap-crossing chunk, and never lets cancel failure mask denial', async () => {
    const headerChunk = new Uint8Array([1, 2, 3])
    let headerCancelCount = 0
    const invalidHeaderRequest = new Request('https://internal.invalid/v1/authorize', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(headerChunk)
        },
        cancel() {
          headerCancelCount += 1
          throw new Error('cancel sentinel')
        },
      }),
      duplex: 'half',
    } as RequestInit)
    await expect(
      readAiInternalJsonRequest(invalidHeaderRequest, 64, schema),
    ).rejects.toThrow(/^AI internal request is invalid$/)
    expect(headerCancelCount).toBe(1)

    const first = new Uint8Array(40).fill(1)
    const crossing = new Uint8Array(40).fill(2)
    let overflowCancelCount = 0
    const overflowRequest = new Request('https://internal.invalid/v1/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(first)
          controller.enqueue(crossing)
        },
        cancel() {
          overflowCancelCount += 1
          throw new Error('overflow cancel sentinel')
        },
      }),
      duplex: 'half',
    } as RequestInit)
    await expect(readAiInternalJsonRequest(overflowRequest, 64, schema)).rejects.toThrow(
      /^AI internal request is invalid$/,
    )
    expect(overflowCancelCount).toBe(1)
    expect(first.every((byte) => byte === 0)).toBe(true)
    expect(crossing.every((byte) => byte === 0)).toBe(true)
  })

  it('rejects media, encoding, length, and chunked overflow before schema delivery', async () => {
    const validBody = '{"nested":{"value":1}}'
    await expect(
      readAiInternalJsonRequest(
        new Request('https://internal.invalid/v1/authorize', {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: validBody,
        }),
        64,
        schema,
      ),
    ).resolves.toEqual({ nested: { value: 1 } })

    const rejected = [
      new Request('https://internal.invalid/v1/authorize', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: validBody,
      }),
      new Request('https://internal.invalid/v1/authorize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
        body: validBody,
      }),
      new Request('https://internal.invalid/v1/authorize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '65',
        },
        body: validBody,
      }),
      new Request('https://internal.invalid/v1/authorize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '1',
        },
        body: validBody,
      }),
      new Request('https://internal.invalid/v1/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(40))
            controller.enqueue(new Uint8Array(40))
            controller.close()
          },
        }),
        duplex: 'half',
      } as RequestInit),
    ]
    for (const request of rejected) {
      await expect(readAiInternalJsonRequest(request, 64, schema)).rejects.toThrow(
        /AI internal request is invalid/,
      )
    }
  })
})

describe('AI settlement transport', () => {
  const valid = {
    operationId: UUIDS.operation,
    permitId: UUIDS.permit,
    attemptNumber: 1,
    nonce: 'AQIDBA',
    disposition: 'success',
    reportedDisposition: 'success',
    usageKnown: true,
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningTokens: 10,
    retryAfterSeconds: null,
    providerRetryable: false,
  } as const

  it('accepts bounded detailed usage and rejects internally inconsistent usage', () => {
    expect(aiSettlementRequestSchema.parse(valid)).toEqual(valid)
    expect(
      aiSettlementRequestSchema.safeParse({ ...valid, cachedInputTokens: 101 }).success,
    ).toBe(false)
    expect(
      aiSettlementRequestSchema.safeParse({
        ...valid,
        disposition: 'no_dispatch',
      }).success,
    ).toBe(false)
    expect(
      aiSettlementRequestSchema.safeParse({ ...valid, retryAfterSeconds: 10 }).success,
    ).toBe(false)
    expect(
      aiSettlementRequestSchema.safeParse({
        ...valid,
        disposition: 'transport_ambiguous',
        reportedDisposition: 'transport_ambiguous',
        usageKnown: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }).success,
    ).toBe(true)
    expect(
      aiSettlementRequestSchema.safeParse({
        ...valid,
        disposition: 'output_invalid',
        usageKnown: false,
        inputTokens: 1,
      }).success,
    ).toBe(false)
    expect(
      aiSettlementRequestSchema.safeParse({
        ...valid,
        disposition: 'no_dispatch',
        reportedDisposition: 'no_dispatch',
        usageKnown: false,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }).success,
    ).toBe(true)
  })

  it('rejects admission-only disposition overrides from gateway settlement requests', () => {
    for (const forbidden of ['source_stale', 'policy_denied'] as const) {
      expect(
        aiSettlementRequestSchema.safeParse({
          ...valid,
          disposition: forbidden,
          reportedDisposition: forbidden,
        }).success,
      ).toBe(false)
      expect(
        aiSettlementRequestSchema.safeParse({
          ...valid,
          reportedDisposition: forbidden,
        }).success,
      ).toBe(false)
    }
  })
})

describe('AI admission signatures', () => {
  const hmac = createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')

  it('authenticates the exact strict descriptor and rejects one-bit mutations', () => {
    const signed = signAiRequestBinding(descriptor(), hmac)
    expect(parseAiAdmissionRequest(signed)).toEqual(signed)
    expect(verifyAiRequestBinding(signed, hmac)).toBe(true)
    expect(
      verifyAiRequestBinding(
        { ...signed, descriptor: { ...signed.descriptor, preparedByteCount: 401 } },
        hmac,
      ),
    ).toBe(false)
    expect(() => parseAiAdmissionRequest({ ...signed, extra: true })).toThrow(z.ZodError)
  })

  it('rejects noncanonical base64url aliases for HMACs and Ed25519 signatures', () => {
    const request = signAiRequestBinding(descriptor(), hmac)
    expect(() =>
      parseAiAdmissionRequest({
        ...request,
        requestBindingHmac: nonCanonicalBase64UrlAlias(request.requestBindingHmac),
      }),
    ).toThrow(z.ZodError)

    const grant = signAiExecutionGrant(
      {
        version: 'ai-execution-grant-v1',
        subjectKind: 'property',
        grantKid: 'grant-v1',
        requestBindingKeyId: request.requestBindingKeyId,
        requestBindingHmac: request.requestBindingHmac,
        route: 'review-analysis',
        operationId: UUIDS.operation,
        permitId: UUIDS.permit,
        attemptNumber: 1,
        nonce: 'AQIDBA',
        limits: request.descriptor.limits,
        callerDeadlineEpochMillis: request.descriptor.callerDeadlineEpochMillis,
        issuedAtEpochMillis: 1_780_000_000_000,
        expiresAtEpochMillis: 1_780_000_070_000,
        replyTokenExpiresAtEpochMillis: null,
        replyDraftExpiresAtEpochMillis: null,
      },
      privateKey,
    )
    expect(() =>
      parseAiExecutionGrant({
        ...grant,
        grantSignature: nonCanonicalBase64UrlAlias(grant.grantSignature),
      }),
    ).toThrow(z.ZodError)
  })

  it('signs every grant field with Ed25519 and verifies exact echoes', () => {
    const request = signAiRequestBinding(descriptor(), hmac)
    const grant = signAiExecutionGrant(
      {
        version: 'ai-execution-grant-v1',
        subjectKind: 'property',
        grantKid: 'grant-v1',
        requestBindingKeyId: request.requestBindingKeyId,
        requestBindingHmac: request.requestBindingHmac,
        route: 'review-analysis',
        operationId: UUIDS.operation,
        permitId: UUIDS.permit,
        attemptNumber: 1,
        nonce: 'AQIDBA',
        limits: request.descriptor.limits,
        callerDeadlineEpochMillis: request.descriptor.callerDeadlineEpochMillis,
        issuedAtEpochMillis: 1_780_000_000_000,
        expiresAtEpochMillis: 1_780_000_070_000,
        replyTokenExpiresAtEpochMillis: null,
        replyDraftExpiresAtEpochMillis: null,
      },
      privateKey,
    )
    expect(parseAiExecutionGrant(grant)).toEqual(grant)
    expect(verifyAiExecutionGrant(grant, new Map([['grant-v1', publicKey]]))).toBe(true)
    expect(
      verifyAiExecutionGrant(
        { ...grant, expiresAtEpochMillis: grant.expiresAtEpochMillis - 1 },
        new Map([['grant-v1', publicKey]]),
      ),
    ).toBe(false)
  })

  it('uses a distinct receipt domain and rejects a grant signature as a receipt signature', () => {
    const request = signAiRequestBinding(descriptor(), hmac)
    const receipt = signAiSettlementReceipt(
      {
        version: 'ai-settlement-receipt-v1',
        receiptKid: 'grant-v1',
        grantKid: 'grant-v1',
        operationId: UUIDS.operation,
        permitId: UUIDS.permit,
        attemptNumber: 1,
        nonce: 'AQIDBA',
        requestBindingHmac: request.requestBindingHmac,
        disposition: 'success',
        reportedDisposition: 'success',
        usageKnown: true,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 20,
        reasoningTokens: 5,
        costMicros: 1_000,
        providerRetryable: false,
        settledAtEpochMillis: 1_780_000_010_000,
        settlementState: 'settled',
      },
      privateKey,
    )
    expect(parseAiSettlementReceipt(receipt)).toEqual(receipt)
    expect(
      aiSettlementReceiptSchema.safeParse({
        ...receipt,
        reportedDisposition: 'policy_denied',
      }).success,
    ).toBe(false)
    expect(verifyAiSettlementReceipt(receipt, new Map([['grant-v1', publicKey]]))).toBe(
      true,
    )

    const grant = signAiExecutionGrant(
      {
        version: 'ai-execution-grant-v1',
        subjectKind: 'property',
        grantKid: 'grant-v1',
        requestBindingKeyId: request.requestBindingKeyId,
        requestBindingHmac: request.requestBindingHmac,
        route: 'review-analysis',
        operationId: UUIDS.operation,
        permitId: UUIDS.permit,
        attemptNumber: 1,
        nonce: 'AQIDBA',
        limits: request.descriptor.limits,
        callerDeadlineEpochMillis: request.descriptor.callerDeadlineEpochMillis,
        issuedAtEpochMillis: 1_780_000_000_000,
        expiresAtEpochMillis: 1_780_000_070_000,
        replyTokenExpiresAtEpochMillis: null,
        replyDraftExpiresAtEpochMillis: null,
      },
      privateKey,
    )
    expect(
      verifyAiSettlementReceipt(
        { ...receipt, receiptSignature: grant.grantSignature },
        new Map([['grant-v1', publicKey]]),
      ),
    ).toBe(false)
  })
})
