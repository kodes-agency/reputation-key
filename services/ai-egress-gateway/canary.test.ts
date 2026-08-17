import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  signAiExecutionGrant,
  signAiSettlementReceipt,
  type AiCanaryExecutionBindingV1,
  type AiExecutionGrantV1,
} from '../../src/shared/ai-internal-transport-contract'
import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import { createAiOneShotCanary } from './canary'
import { deriveCanarySafetyIdentifier } from './safety-identifier'
import type { AiAdmissionClient, OpenAiConnector } from './contracts'

const signingKeys = generateKeyPairSync('ed25519')
const keyring = createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`)
const binding: AiCanaryExecutionBindingV1 = {
  canaryAuthorizationId: '10000000-0000-4000-8000-000000000003',
  canaryAuthorizationGeneration: 1,
  releaseSha: 'b'.repeat(40),
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
}

function createAdmission(
  options: Readonly<{
    settledAtEpochMillis?: number
    onSettle?: (signal: AbortSignal) => void
    overrideDisposition?: 'policy_denied'
  }> = {},
): AiAdmissionClient {
  let grant: AiExecutionGrantV1 | null = null
  return {
    authorize: async (request) => {
      grant = signAiExecutionGrant(
        {
          version: 'ai-execution-grant-v1',
          subjectKind: 'synthetic_canary',
          grantKid: 'grant-v1',
          requestBindingKeyId: request.requestBindingKeyId,
          requestBindingHmac: request.requestBindingHmac,
          route: 'synthetic-canary',
          operationId: request.descriptor.operationId,
          permitId: request.descriptor.permitId,
          attemptNumber: request.descriptor.attemptNumber,
          nonce: Buffer.alloc(32, 1).toString('base64url'),
          limits: request.descriptor.limits,
          callerDeadlineEpochMillis: request.descriptor.callerDeadlineEpochMillis,
          issuedAtEpochMillis: 1_780_000_000_000,
          expiresAtEpochMillis: request.descriptor.callerDeadlineEpochMillis,
          replyTokenExpiresAtEpochMillis: null,
          replyDraftExpiresAtEpochMillis: null,
        },
        signingKeys.privateKey,
      )
      return { status: 'authorized', grant }
    },
    settle: async (request, signal) => {
      options.onSettle?.(signal)
      if (grant === null) return { status: 'denied', code: 'missing_grant' }
      const disposition = options.overrideDisposition ?? request.disposition
      return {
        status: 'settled',
        receipt: signAiSettlementReceipt(
          {
            version: 'ai-settlement-receipt-v1',
            receiptKid: 'grant-v1',
            grantKid: grant.grantKid,
            operationId: request.operationId,
            permitId: request.permitId,
            attemptNumber: request.attemptNumber,
            nonce: request.nonce,
            requestBindingHmac: grant.requestBindingHmac,
            disposition,
            reportedDisposition: request.reportedDisposition,
            providerRetryable:
              disposition === request.disposition ? request.providerRetryable : false,
            usageKnown: request.usageKnown,
            inputTokens: request.inputTokens,
            cachedInputTokens: request.cachedInputTokens,
            outputTokens: request.outputTokens,
            reasoningTokens: request.reasoningTokens,
            costMicros:
              request.disposition === 'no_dispatch'
                ? 0
                : Math.ceil(
                    ((request.inputTokens - request.cachedInputTokens) * 750_000 +
                      request.cachedInputTokens * 75_000 +
                      request.outputTokens * 4_500_000) /
                      1_000_000,
                  ),
            settledAtEpochMillis: options.settledAtEpochMillis ?? 1_780_000_002_000,
            settlementState:
              disposition === 'no_dispatch'
                ? 'released'
                : disposition === 'transport_ambiguous'
                  ? 'ambiguous'
                  : 'settled',
          },
          signingKeys.privateKey,
        ),
      }
    },
    readiness: async () => true,
  }
}

describe('one-shot synthetic canary', () => {
  it('uses the fixed source, shard 00 and safety identifier and settles one invocation', async () => {
    const invoke = vi.fn<OpenAiConnector['invoke']>(async (invocation) => {
      expect(invocation.descriptor.subjectKind).toBe('synthetic_canary')
      expect(invocation.descriptor.promptCacheShard).toBe(0)
      expect(invocation.sdkRequest.prompt_cache_key).toMatch(/:00$/)
      expect(invocation.sdkRequest.safety_identifier).toBe(deriveCanarySafetyIdentifier())
      expect(invocation.sdkRequest.input[1]?.content).toBe(
        '{"canary":"repkey_synthetic_canary_v1"}',
      )
      return {
        disposition: 'success',
        result: { marker: 'synthetic_canary_ok' },
        reportedDisposition: 'success',
        providerRetryable: false,
        usageKnown: true,
        usage: {
          inputTokens: 10,
          cachedTokens: 0,
          outputTokens: 3,
          reasoningTokens: 1,
          totalTokens: 13,
        },
        retryAfterSeconds: null,
        outboundFetchUsed: true,
      }
    })
    const canary = createAiOneShotCanary({
      admission: createAdmission(),
      connector: { invoke },
      requestBindingKeys: keyring,
      admissionPublicKeys: new Map([['grant-v1', signingKeys.publicKey]]),
      releaseSha: binding.releaseSha,
      now: () => 1_780_000_001_000,
    })
    const result = await canary.run(
      {
        operationId: '10000000-0000-4000-8000-000000000001',
        permitId: '10000000-0000-4000-8000-000000000002',
        attemptNumber: 1,
        deadlineEpochMillis: 1_780_000_070_000,
        binding,
      },
      new AbortController().signal,
    )
    expect(result).toEqual({ status: 'passed', disposition: 'success' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('accepts a signed admission policy override using the final receipt state', async () => {
    const canary = createAiOneShotCanary({
      admission: createAdmission({ overrideDisposition: 'policy_denied' }),
      connector: {
        invoke: async () => ({
          disposition: 'no_dispatch',
          reportedDisposition: 'no_dispatch',
          result: null,
          providerRetryable: false,
          usageKnown: false,
          usage: {
            inputTokens: 0,
            cachedTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
          },
          retryAfterSeconds: null,
          outboundFetchUsed: false,
        }),
      },
      requestBindingKeys: keyring,
      admissionPublicKeys: new Map([['grant-v1', signingKeys.publicKey]]),
      releaseSha: binding.releaseSha,
      now: () => 1_780_000_001_000,
    })
    await expect(
      canary.run(
        {
          operationId: '10000000-0000-4000-8000-000000000001',
          permitId: '10000000-0000-4000-8000-000000000002',
          attemptNumber: 1,
          deadlineEpochMillis: 1_780_000_070_000,
          binding,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'failed',
      disposition: 'policy_denied',
    })
  })

  it('settles once on its cleanup signal and withholds output when the caller aborts', async () => {
    const caller = new AbortController()
    const settlementSignals: AbortSignal[] = []
    const admission = createAdmission({
      onSettle: (signal) => settlementSignals.push(signal),
    })
    const invoke = vi.fn<OpenAiConnector['invoke']>(async () => {
      caller.abort()
      return {
        disposition: 'success',
        result: { marker: 'synthetic_canary_ok' },
        reportedDisposition: 'success',
        providerRetryable: false,
        usageKnown: true,
        usage: {
          inputTokens: 10,
          cachedTokens: 0,
          outputTokens: 3,
          reasoningTokens: 1,
          totalTokens: 13,
        },
        retryAfterSeconds: null,
        outboundFetchUsed: true,
      }
    })
    const canary = createAiOneShotCanary({
      admission,
      connector: { invoke },
      requestBindingKeys: keyring,
      admissionPublicKeys: new Map([['grant-v1', signingKeys.publicKey]]),
      releaseSha: binding.releaseSha,
      now: () => 1_780_000_001_000,
    })
    const result = await canary.run(
      {
        operationId: '10000000-0000-4000-8000-000000000001',
        permitId: '10000000-0000-4000-8000-000000000002',
        attemptNumber: 1,
        deadlineEpochMillis: 1_780_000_070_000,
        binding,
      },
      caller.signal,
    )
    expect(result).toEqual({ status: 'failed', disposition: 'success' })
    expect(settlementSignals).toHaveLength(1)
    expect(settlementSignals[0]?.aborted).toBe(false)
  })

  it('discards a successful canary settled exactly at grant expiry', async () => {
    const expiresAt = 1_780_000_070_000
    const clock = [expiresAt - 65_000, expiresAt]
    const canary = createAiOneShotCanary({
      admission: createAdmission({ settledAtEpochMillis: expiresAt }),
      connector: {
        invoke: async () => ({
          disposition: 'success',
          result: { marker: 'synthetic_canary_ok' },
          reportedDisposition: 'success',
          providerRetryable: false,
          usageKnown: true,
          usage: {
            inputTokens: 10,
            cachedTokens: 0,
            outputTokens: 3,
            reasoningTokens: 1,
            totalTokens: 13,
          },
          retryAfterSeconds: null,
          outboundFetchUsed: true,
        }),
      },
      requestBindingKeys: keyring,
      admissionPublicKeys: new Map([['grant-v1', signingKeys.publicKey]]),
      releaseSha: binding.releaseSha,
      now: () => clock.shift() ?? expiresAt,
    })
    await expect(
      canary.run(
        {
          operationId: '10000000-0000-4000-8000-000000000001',
          permitId: '10000000-0000-4000-8000-000000000002',
          attemptNumber: 1,
          deadlineEpochMillis: expiresAt,
          binding,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      status: 'failed',
      disposition: 'success',
    })
  })

  it('rejects a non-first attempt or release-SHA mismatch before admission and OpenAI', async () => {
    const admission = createAdmission()
    const authorize = vi.spyOn(admission, 'authorize')
    const invoke = vi.fn<OpenAiConnector['invoke']>()
    const canary = createAiOneShotCanary({
      admission,
      connector: { invoke },
      requestBindingKeys: keyring,
      admissionPublicKeys: new Map([['grant-v1', signingKeys.publicKey]]),
      releaseSha: 'c'.repeat(40),
    })
    for (const claim of [
      { attemptNumber: 1, releaseSha: binding.releaseSha },
      { attemptNumber: 2, releaseSha: 'c'.repeat(40) },
    ]) {
      await expect(
        canary.run(
          {
            operationId: '10000000-0000-4000-8000-000000000001',
            permitId: '10000000-0000-4000-8000-000000000002',
            attemptNumber: claim.attemptNumber,
            deadlineEpochMillis: 1_780_000_070_000,
            binding: { ...binding, releaseSha: claim.releaseSha },
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        status: 'failed',
        disposition: 'policy_denied',
      })
    }
    expect(authorize).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
