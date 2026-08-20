import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from './security/versioned-hmac-keyring'
import {
  signAiRequestBinding,
  verifyAiExecutionGrant,
  verifyAiSettlementReceipt,
  type AiAdmissionDescriptorV1,
  type AiSettlementRequestV1,
} from './ai-internal-transport-contract'
import {
  createAiExecutionAdmissionService,
  type AiAdmissionDatabaseAuthority,
} from '../../services/ai-execution-admission/service'

const UUIDS = {
  operation: '20000000-0000-4000-8000-000000000001',
  permit: '20000000-0000-4000-8000-000000000002',
  authorization: '20000000-0000-4000-8000-000000000003',
  global: '20000000-0000-4000-8000-000000000004',
  provider: '20000000-0000-4000-8000-000000000005',
  analysis: '20000000-0000-4000-8000-000000000006',
  reply: '20000000-0000-4000-8000-000000000007',
  trend: '20000000-0000-4000-8000-000000000008',
} as const
const SHA256 = 'a'.repeat(64)
const RELEASE_SHA = 'b'.repeat(40)

function canaryDescriptor(): AiAdmissionDescriptorV1 {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'synthetic_canary',
    route: 'synthetic-canary',
    operationId: UUIDS.operation,
    permitId: UUIDS.permit,
    attemptNumber: 1,
    organizationId: null,
    propertyId: null,
    internalSubjectId: null,
    actorId: null,
    binding: null,
    canaryBinding: {
      canaryAuthorizationId: UUIDS.authorization,
      canaryAuthorizationGeneration: 1,
      releaseSha: RELEASE_SHA,
      canaryProfileVersion: 'synthetic-canary-v1',
      safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'synthetic-canary-v1',
      stopFence: {
        globalControlId: UUIDS.global,
        globalGeneration: 1,
        providerControlId: UUIDS.provider,
        providerGeneration: 1,
        allCapabilityStopFences: [
          {
            capability: 'review_analysis',
            capabilityControlId: UUIDS.analysis,
            capabilityGeneration: 1,
          },
          {
            capability: 'reply_drafting',
            capabilityControlId: UUIDS.reply,
            capabilityGeneration: 1,
          },
          {
            capability: 'property_trends',
            capabilityControlId: UUIDS.trend,
            capabilityGeneration: 1,
          },
        ],
      },
    },
    releaseSha: RELEASE_SHA,
    canaryAuthorizationId: UUIDS.authorization,
    sourceDigest: SHA256,
    preparedDigest: 'c'.repeat(64),
    sourceByteCount: 64,
    preparedByteCount: 256,
    providerPayloadByteCount: 128,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 1_024,
      providerPayloadBytes: 2_048,
      preparedRequestBytes: 4_096,
      responseBytes: 8_192,
      outputTokens: 64,
      costMicros: 100_000,
    },
    callerDeadlineEpochMillis: 1_780_000_070_000,
    observedContentExpiresAtEpochMillis: null,
    redactionCountry: null,
    redactionProfileVersion: null,
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
  }
}

function authority(): AiAdmissionDatabaseAuthority {
  return {
    authorizeProperty: vi.fn(async () => ({
      status: 'denied' as const,
      code: 'subject_mismatch' as const,
    })),
    authorizeCanary: vi.fn(async () => ({
      status: 'admitted' as const,
      nonce: 'AQIDBA',
      issuedAtEpochMillis: 1_780_000_000_000,
      expiresAtEpochMillis: 1_780_000_070_000,
      replyTokenExpiresAtEpochMillis: null,
      replyDraftExpiresAtEpochMillis: null,
    })),
    settle: vi.fn(async (input: AiSettlementRequestV1) => ({
      status: 'settled' as const,
      grantKid: 'grant-v1',
      requestBindingHmac: 'A'.repeat(43),
      disposition: input.disposition,
      providerRetryable: input.providerRetryable,
      usageKnown: input.usageKnown,
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
      reasoningTokens: input.reasoningTokens,
      costMicros: 50_000,
      settledAtEpochMillis: 1_780_000_001_000,
      settlementState: 'settled' as const,
    })),
    reapExpired: vi.fn(async () => 0),
    readiness: vi.fn(async () => true),
  }
}

describe('AI execution admission service', () => {
  const requestKeys = createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')

  it('rejects an invalid prepared-input attestation before database work', async () => {
    const database = authority()
    const service = createAiExecutionAdmissionService({
      requestBindingKeys: requestKeys,
      signingKid: 'grant-v1',
      signingPrivateKey: privateKey,
      database,
    })
    const request = signAiRequestBinding(canaryDescriptor(), requestKeys)
    const result = await service.authorize({
      ...request,
      requestBindingHmac: `${request.requestBindingHmac.slice(0, 42)}A`,
    })
    expect(result).toEqual({ ok: false, code: 'request_binding_invalid' })
    expect(database.authorizeCanary).not.toHaveBeenCalled()
    expect(database.authorizeProperty).not.toHaveBeenCalled()
  })

  it('routes the strict canary branch and signs the one-use grant', async () => {
    const database = authority()
    const service = createAiExecutionAdmissionService({
      requestBindingKeys: requestKeys,
      signingKid: 'grant-v1',
      signingPrivateKey: privateKey,
      database,
    })
    const request = signAiRequestBinding(canaryDescriptor(), requestKeys)
    const result = await service.authorize(request)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected admitted result')
    expect(database.authorizeCanary).toHaveBeenCalledOnce()
    expect(database.authorizeProperty).not.toHaveBeenCalled()
    expect(result.grant.requestBindingHmac).toBe(request.requestBindingHmac)
    expect(verifyAiExecutionGrant(result.grant, new Map([['grant-v1', publicKey]]))).toBe(
      true,
    )
  })

  it('returns code-only database denials without a grant', async () => {
    const database = authority()
    vi.mocked(database.authorizeCanary).mockResolvedValueOnce({
      status: 'denied',
      code: 'quota_exhausted',
    })
    const service = createAiExecutionAdmissionService({
      requestBindingKeys: requestKeys,
      signingKid: 'grant-v1',
      signingPrivateKey: privateKey,
      database,
    })
    await expect(
      service.authorize(signAiRequestBinding(canaryDescriptor(), requestKeys)),
    ).resolves.toEqual({ ok: false, code: 'quota_exhausted' })
  })

  it('signs the database-clock settlement and exact echoed usage', async () => {
    const database = authority()
    const service = createAiExecutionAdmissionService({
      requestBindingKeys: requestKeys,
      signingKid: 'grant-v1',
      signingPrivateKey: privateKey,
      database,
    })
    const result = await service.settle({
      operationId: UUIDS.operation,
      permitId: UUIDS.permit,
      attemptNumber: 1,
      nonce: 'AQIDBA',
      disposition: 'success',
      reportedDisposition: 'success',
      providerRetryable: false,
      usageKnown: true,
      inputTokens: 100,
      cachedInputTokens: 25,
      outputTokens: 20,
      reasoningTokens: 5,
      retryAfterSeconds: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected settled result')
    expect(result.receipt.receiptKid).toBe('grant-v1')
    expect(result.receipt.costMicros).toBe(50_000)
    expect(
      verifyAiSettlementReceipt(result.receipt, new Map([['grant-v1', publicKey]])),
    ).toBe(true)
  })

  it('does not translate database loss into an admission', async () => {
    const database = authority()
    vi.mocked(database.authorizeCanary).mockRejectedValueOnce(new Error('database down'))
    const service = createAiExecutionAdmissionService({
      requestBindingKeys: requestKeys,
      signingKid: 'grant-v1',
      signingPrivateKey: privateKey,
      database,
    })
    await expect(
      service.authorize(signAiRequestBinding(canaryDescriptor(), requestKeys)),
    ).rejects.toThrow('AI admission authority is unavailable')
  })
})
