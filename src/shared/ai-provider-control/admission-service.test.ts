import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  signAiRequestBinding,
  verifyAiExecutionGrant,
  verifyAiSettlementReceipt,
  type AiAdmissionDescriptorV1,
} from '#/shared/ai-internal-transport-contract'
import {
  createAiExecutionAdmissionService,
  type AiAdmissionDatabaseAuthority,
} from './admission-service'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const requestKeys = createVersionedHmacKeyring(
  `v1:${Buffer.alloc(32, 7).toString('hex')}`,
)

function descriptor(): AiAdmissionDescriptorV1 {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'synthetic_canary',
    route: 'synthetic-canary',
    operationId: '10000000-0000-4000-8000-000000000001',
    permitId: '10000000-0000-4000-8000-000000000002',
    attemptNumber: 1,
    sourceDigest: 'a'.repeat(64),
    preparedDigest: 'b'.repeat(64),
    sourceByteCount: 100,
    preparedByteCount: 200,
    providerPayloadByteCount: 200,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 1_000,
      providerPayloadBytes: 2_000,
      preparedRequestBytes: 2_000,
      responseBytes: 4_000,
      outputTokens: 100,
      costMicros: 10_000,
    },
    callerDeadlineEpochMillis: 1_780_000_100_000,
    organizationId: null,
    propertyId: null,
    internalSubjectId: null,
    actorId: null,
    binding: null,
    canaryBinding: {
      canaryAuthorizationId: '10000000-0000-4000-8000-000000000003',
      canaryAuthorizationGeneration: 1,
      releaseSha: 'c'.repeat(40),
      canaryProfileVersion: 'synthetic-canary-v1',
      safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'synthetic-canary-v1',
      stopFence: {
        globalControlId: '10000000-0000-4000-8000-000000000004',
        globalGeneration: 1,
        providerControlId: '10000000-0000-4000-8000-000000000005',
        providerGeneration: 1,
        allCapabilityStopFences: [
          {
            capability: 'review_analysis',
            capabilityControlId: '10000000-0000-4000-8000-000000000006',
            capabilityGeneration: 1,
          },
          {
            capability: 'reply_drafting',
            capabilityControlId: '10000000-0000-4000-8000-000000000007',
            capabilityGeneration: 1,
          },
          {
            capability: 'property_trends',
            capabilityControlId: '10000000-0000-4000-8000-000000000008',
            capabilityGeneration: 1,
          },
        ],
      },
    },
    releaseSha: 'c'.repeat(40),
    canaryAuthorizationId: '10000000-0000-4000-8000-000000000003',
    observedContentExpiresAtEpochMillis: null,
    redactionCountry: null,
    redactionProfileVersion: null,
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
  }
}

function database(): AiAdmissionDatabaseAuthority {
  return {
    authorizeProperty: vi.fn(async () => ({
      status: 'denied' as const,
      code: 'subject_mismatch' as const,
    })),
    authorizeCanary: vi.fn(async () => ({
      status: 'admitted' as const,
      nonce: 'AQIDBA',
      issuedAtEpochMillis: 1_780_000_000_000,
      expiresAtEpochMillis: 1_780_000_100_000,
      replyTokenExpiresAtEpochMillis: null,
      replyDraftExpiresAtEpochMillis: null,
    })),
    settle: vi.fn(async () => ({
      status: 'settled' as const,
      grantKid: 'grant-v1',
      requestBindingHmac: 'A'.repeat(43),
      disposition: 'success' as const,
      reportedDisposition: 'success' as const,
      providerRetryable: false,
      usageKnown: true,
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      reasoningTokens: 1,
      costMicros: 1_000,
      settledAtEpochMillis: 1_780_000_010_000,
      settlementState: 'settled' as const,
    })),
    reapExpired: vi.fn(async () => 2),
    readiness: vi.fn(async () => true),
  }
}

function service(authority: AiAdmissionDatabaseAuthority = database()) {
  return createAiExecutionAdmissionService({
    requestBindingKeys: requestKeys,
    signingKid: 'grant-v1',
    signingPrivateKey: privateKey,
    database: authority,
  })
}

describe('AI execution admission service', () => {
  it('verifies the request binding before consuming a canary permit', async () => {
    const authority = database()
    const request = signAiRequestBinding(descriptor(), requestKeys)
    const result = await service(authority).authorize(request)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected an admitted grant')
    expect(verifyAiExecutionGrant(result.grant, new Map([['grant-v1', publicKey]]))).toBe(
      true,
    )
    expect(authority.authorizeCanary).toHaveBeenCalledOnce()

    const invalid = {
      ...request,
      requestBindingHmac: `${request.requestBindingHmac[0] === 'A' ? 'B' : 'A'}${request.requestBindingHmac.slice(1)}`,
    }
    await expect(service(authority).authorize(invalid)).resolves.toEqual({
      ok: false,
      code: 'request_binding_invalid',
    })
    expect(authority.authorizeCanary).toHaveBeenCalledOnce()
  })

  it('signs the canonical database settlement result', async () => {
    const settlement = {
      operationId: '10000000-0000-4000-8000-000000000001',
      permitId: '10000000-0000-4000-8000-000000000002',
      attemptNumber: 1,
      nonce: 'AQIDBA',
      disposition: 'success',
      reportedDisposition: 'success',
      providerRetryable: false,
      usageKnown: true,
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      reasoningTokens: 1,
      retryAfterSeconds: null,
    } as const
    const result = await service().settle(settlement)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a settlement receipt')
    expect(result.receipt).toMatchObject({
      grantKid: 'grant-v1',
      requestBindingHmac: 'A'.repeat(43),
      costMicros: 1_000,
      settlementState: 'settled',
    })
    expect(
      verifyAiSettlementReceipt(result.receipt, new Map([['grant-v1', publicKey]])),
    ).toBe(true)
  })

  it('releases an admitted permit as no-dispatch when grant signing fails', async () => {
    const authority = database()
    vi.mocked(authority.settle).mockImplementationOnce(async (request, receiptKid) => ({
      status: 'settled',
      grantKid: receiptKid,
      requestBindingHmac: 'A'.repeat(43),
      disposition: request.disposition,
      providerRetryable: false,
      usageKnown: false,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costMicros: 0,
      settledAtEpochMillis: 1_780_000_001_000,
      settlementState: 'released',
    }))
    const admission = createAiExecutionAdmissionService({
      requestBindingKeys: requestKeys,
      signingKid: 'grant-v1',
      signingPrivateKey: publicKey,
      database: authority,
    })

    await expect(
      admission.authorize(signAiRequestBinding(descriptor(), requestKeys)),
    ).rejects.toThrow('AI admission authority is unavailable')
    expect(authority.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: 'no_dispatch',
        usageKnown: false,
        providerRetryable: false,
      }),
      'grant-v1',
    )
  })

  it('fails closed when its database authority is unavailable', async () => {
    const authority = database()
    vi.mocked(authority.authorizeCanary).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(authority.readiness).mockRejectedValueOnce(new Error('offline'))

    await expect(
      service(authority).authorize(signAiRequestBinding(descriptor(), requestKeys)),
    ).rejects.toThrow('AI admission authority is unavailable')
    await expect(service(authority).readiness()).resolves.toBe(false)
  })
})
