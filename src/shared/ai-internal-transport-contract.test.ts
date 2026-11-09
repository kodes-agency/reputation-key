import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { createVersionedHmacKeyring } from './security/versioned-hmac-keyring'
import { MERCHANT_AI_NOTICE_VERSION } from './merchant-ai-notice-contract'
import {
  AI_INTERNAL_RESPONSE_MAX_BYTES,
  aiSettlementRequestSchema,
  aiSettlementReceiptSchema,
  parseAiAdmissionRequest,
  parseAiExecutionGrant,
  parseAiSettlementReceipt,
  signAiExecutionGrant,
  signAiRequestBinding,
  verifyAiExecutionGrant,
  verifyAiRequestBinding,
  type AiAdmissionDescriptorV1,
} from './ai-internal-transport-contract'
import {
  AI_INTERNAL_JSON_MAX_DEPTH,
  AI_INTERNAL_JSON_MAX_NODES,
  explainJsonBytesRejection,
  parseAiInternalJsonBytes,
  parseAiProviderJsonBytes,
} from './ai-json'

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
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
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
      operationProfileVersion: 'review-analysis-v2',
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

  it('accepts fractional numbers for provider bodies only, keeping every other rule', () => {
    const fractional = new TextEncoder().encode('{"top_p":0.98}')
    expect(parseAiProviderJsonBytes(fractional, 128, z.unknown())).toEqual({
      top_p: 0.98,
    })
    expect(() => parseAiInternalJsonBytes(fractional, 128, z.unknown())).toThrow(
      /AI internal request is invalid/,
    )
    for (const raw of [
      '{"top_p":0.98,"top_p":0.5}',
      '{"top_p":0.98} null',
      '{"value":"\\ud800"}',
    ]) {
      expect(() =>
        parseAiProviderJsonBytes(new TextEncoder().encode(raw), 128, z.unknown()),
      ).toThrow(/AI internal request is invalid/)
    }
    expect(() => parseAiProviderJsonBytes(fractional, 4, z.unknown())).toThrow(
      /AI internal request is invalid/,
    )
  })

  it('names the rejected rule and JSON path for the number policy in force', () => {
    const fractional = new TextEncoder().encode('{"a":{"b":[1,0.98]}}')
    expect(explainJsonBytesRejection(fractional, 128)).toBe(
      'scan:ok;parse:ok;validate:number_not_integer:$.a.b[1]=0.98;nodes:5',
    )
    expect(explainJsonBytesRejection(fractional, 128, 'finite-numbers')).toBe(
      'scan:ok;parse:ok;validate:ok;nodes:5',
    )
    expect(explainJsonBytesRejection(new TextEncoder().encode('{'), 128)).toBe(
      'scan:fail;parse:fail',
    )
    expect(explainJsonBytesRejection(new Uint8Array(0), 128)).toBe('byte_length:0')
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

  it('validates settlement usage and rejects a signed envelope as a typed result', () => {
    const request = signAiRequestBinding(descriptor(), hmac)
    const receipt = parseAiSettlementReceipt({
      version: 'ai-settlement-receipt-v1',
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
    })
    expect(parseAiSettlementReceipt(receipt)).toEqual(receipt)
    expect(
      aiSettlementReceiptSchema.safeParse({
        ...receipt,
        reportedDisposition: 'policy_denied',
      }).success,
    ).toBe(false)
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
      aiSettlementReceiptSchema.safeParse({
        ...receipt,
        grantSignature: grant.grantSignature,
      }).success,
    ).toBe(false)
  })
})
