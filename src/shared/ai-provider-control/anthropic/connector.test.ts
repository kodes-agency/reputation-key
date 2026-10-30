import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import {
  signAiExecutionGrant,
  type AiExecutionGrantV1,
} from '#/shared/ai-internal-transport-contract'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import { REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING } from '#/shared/review-analysis-v3-profile'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  evidencePreparer,
  fakeGrant,
  fakeSettlementReceipt,
  preparableV3Request,
  v3TestProfile,
} from '../review-evidence.test-fixtures'
import { createAiProviderRegistry } from '../provider-selection'
import {
  PINNED_ANTHROPIC_DISPATCHER_LIMITS,
  createAnthropicConnector,
  createRestrictedAnthropicLookup,
  isForbiddenAnthropicAddress,
  type PinnedAnthropicOutbound,
} from './connector'
import {
  anthropicMessageBody,
  scriptedMessagesFetch,
  type ScriptedMessagesResult,
} from './messages-stub.test-fixtures'
import type { PreparedAnthropicInvocation } from './prepared-invocation'
import { createAnthropicProviderPreparation } from './provider-adapter'
import { ANTHROPIC_MESSAGES_URL } from './request-profile'

const NOW = 1_780_000_001_000
const requestBindingKeys = createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`)
const admissionKeys = generateKeyPairSync('ed25519')
let nonce = 0

beforeEach(() => {
  vi.spyOn(process.versions, 'node', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  )
  vi.spyOn(process.versions, 'icu', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  )
  vi.spyOn(process.versions, 'unicode', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function preparedInvocation(): PreparedAnthropicInvocation {
  return preparedExecution().invocation as PreparedAnthropicInvocation
}

function preparedExecution() {
  const preparation = createAnthropicProviderPreparation()
  const base = preparableV3Request()
  const request = {
    ...base,
    provider: {
      id: 'anthropic' as const,
      model: preparation.requestProfile.model,
      requestProfileVersion: preparation.requestProfile.version,
      requestProfileDigest: preparation.requestProfile.digest,
    },
  }
  const profile = {
    ...v3TestProfile(),
    attestedProviders: ['anthropic'] as const,
    pairings: { anthropic: REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING },
  }
  return evidencePreparer({
    profiles: [profile],
    providers: createAiProviderRegistry([preparation]),
  }).prepare(request)
}

function grantFor(invocation: PreparedAnthropicInvocation): AiExecutionGrantV1 {
  nonce += 1
  return signAiExecutionGrant(
    {
      version: 'ai-execution-grant-v1',
      subjectKind: invocation.descriptor.subjectKind,
      grantKid: 'grant-v1',
      requestBindingKeyId: invocation.requestBindingKeyId,
      requestBindingHmac: invocation.requestBindingHmac,
      route: invocation.descriptor.route,
      operationId: invocation.descriptor.operationId,
      permitId: invocation.descriptor.permitId,
      attemptNumber: invocation.descriptor.attemptNumber,
      nonce: Buffer.alloc(32, nonce).toString('base64url'),
      limits: invocation.descriptor.limits,
      callerDeadlineEpochMillis: invocation.descriptor.callerDeadlineEpochMillis,
      issuedAtEpochMillis: NOW - 1_000,
      expiresAtEpochMillis: invocation.descriptor.callerDeadlineEpochMillis,
      replyTokenExpiresAtEpochMillis: null,
      replyDraftExpiresAtEpochMillis: null,
    },
    admissionKeys.privateKey,
  )
}

function harness(
  script: readonly ScriptedMessagesResult[],
  options: Readonly<{ pinnedOutboundFactory?: () => PinnedAnthropicOutbound }> = {},
) {
  const invocation = preparedInvocation()
  const grant = grantFor(invocation)
  const outbound = scriptedMessagesFetch(script)
  const connector = createAnthropicConnector({
    apiKey: 'invented-key',
    requestBindingKeys,
    admissionPublicKeys: new Map([['grant-v1', admissionKeys.publicKey]]),
    now: () => NOW,
    ...(options.pinnedOutboundFactory === undefined
      ? { outboundFetch: outbound }
      : { pinnedOutboundFactory: options.pinnedOutboundFactory }),
  })
  return { invocation, grant, outbound, connector }
}

const outputSchema = z.object({ ok: z.boolean() }).strict()

describe('Anthropic connector through the official SDK', () => {
  it('passes exact attested bytes through SDK 1.3.0 and returns a Messages answer', async () => {
    const value = harness([
      { kind: 'message', body: anthropicMessageBody({ answer: { ok: true } }) },
    ])
    const expected = Buffer.from(value.invocation.canonicalProviderBytes)
    const outcome = await value.connector.invoke(
      value.invocation,
      value.grant,
      outputSchema,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      disposition: 'success',
      result: { ok: true },
      usageKnown: true,
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 1 },
    })
    expect(value.outbound.calls).toHaveLength(1)
    expect(value.outbound.calls[0]?.url).toBe(ANTHROPIC_MESSAGES_URL)
    expect(value.outbound.calls[0]?.bodyBytes).toEqual(expected)
  })

  it('fails closed when the SDK environment injects a custom header', async () => {
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'x-injected: refused')
    const value = harness([
      { kind: 'message', body: anthropicMessageBody({ answer: { ok: true } }) },
    ])
    const outcome = await value.connector.invoke(
      value.invocation,
      value.grant,
      outputSchema,
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({
      disposition: 'no_dispatch',
      outboundFetchUsed: false,
    })
    expect(value.outbound.calls).toHaveLength(0)
  })

  it.each([
    [
      400,
      'invalid_request_error',
      'ordinary invalid request',
      undefined,
      'provider_refused',
      false,
    ],
    [
      400,
      'invalid_request_error',
      'Your credit balance is too low',
      undefined,
      'quota_exhausted',
      false,
    ],
    [402, 'billing_error', 'billing failed', undefined, 'quota_exhausted', false],
    [429, 'rate_limit_error', 'ordinary limit', undefined, 'rate_limited', true],
    [
      429,
      'rate_limit_error',
      'tier cap',
      { error_code: 'enforced_spend_limit_reached' },
      'quota_exhausted',
      false,
    ],
    [500, 'api_error', 'failed', undefined, 'provider_unavailable', true],
    [504, 'timeout_error', 'timed out', undefined, 'provider_unavailable', true],
    [529, 'overloaded_error', 'busy', undefined, 'provider_unavailable', true],
  ] as const)(
    'maps status %i and %s without an SDK retry',
    async (status, type, message, details, disposition, providerRetryable) => {
      const value = harness([
        {
          kind: 'error',
          status,
          type,
          message,
          ...(details === undefined ? {} : { details }),
          retryAfterSeconds: 7,
        },
      ])
      const outcome = await value.connector.invoke(
        value.invocation,
        value.grant,
        outputSchema,
        new AbortController().signal,
      )
      expect(outcome).toMatchObject({ disposition, providerRetryable, result: null })
      expect(value.outbound.calls).toHaveLength(1)
    },
  )

  it.each([
    ['provider_deadline', 'deadline_exceeded'],
    ['caller_aborted', 'caller_aborted'],
  ])('maps an abort after dispatch from %s', async (reason, disposition) => {
    const invocation = preparedInvocation()
    const grant = grantFor(invocation)
    const controller = new AbortController()
    const outbound = vi.fn(async () => {
      controller.abort(reason)
      throw new Error('invented abort')
    })
    const connector = createAnthropicConnector({
      apiKey: 'invented-key',
      requestBindingKeys,
      admissionPublicKeys: new Map([['grant-v1', admissionKeys.publicKey]]),
      now: () => NOW,
      outboundFetch: outbound,
    })
    await expect(
      connector.invoke(invocation, grant, outputSchema, controller.signal),
    ).resolves.toMatchObject({ disposition, outboundFetchUsed: true })
  })

  it('uses an injected pinned factory and marks readiness false after close fails', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch')
    const fake = scriptedMessagesFetch([
      { kind: 'message', body: anthropicMessageBody({ answer: { ok: true } }) },
    ])
    const destroy = vi.fn()
    const pinned: PinnedAnthropicOutbound = {
      fetch: fake,
      close: async () => {
        throw new Error('invented close failure')
      },
      destroy,
    }
    const value = harness([], { pinnedOutboundFactory: () => pinned })
    await expect(
      value.connector.invoke(
        value.invocation,
        value.grant,
        outputSchema,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ disposition: 'success' })
    expect(fake.calls).toHaveLength(1)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(value.connector.readiness?.()).toBe(false)
  })

  it('prepares, invokes, and repairs one billed v3 answer at the acceptance point', async () => {
    const execution = preparedExecution()
    const invocation = execution.invocation as PreparedAnthropicInvocation
    const thing = 'x'.repeat(60)
    const mention = {
      topic: 'speed_waiting',
      polarity: 'negative',
      strength: 'clear',
      thing,
      issue: 'slow',
      sentences: [0, 2, 2],
      names_person: null,
    }
    const raw = {
      sentiment: 'negative',
      mentions: Array.from({ length: 49 }, () => ({ ...mention })),
      urgent: null,
    }
    const outbound = scriptedMessagesFetch([
      { kind: 'message', body: anthropicMessageBody({ answer: raw }) },
    ])
    const connector = createAnthropicConnector({
      apiKey: 'invented-key',
      requestBindingKeys,
      admissionPublicKeys: new Map([['grant-v1', admissionKeys.publicKey]]),
      now: () => NOW,
      outboundFetch: outbound,
    })

    const outcome = await connector.invoke(
      invocation,
      grantFor(invocation),
      execution.outputSchema,
      new AbortController().signal,
    )
    expect(outcome.disposition).toBe('success')
    const accepted = execution.acceptProviderResult(outcome.result)
    const response = accepted?.buildResponse(fakeSettlementReceipt(), fakeGrant())

    expect(response).toMatchObject({
      route: 'review-analysis',
      status: 'success',
      result: {
        contract: 'review-analysis-v3',
        answer: {
          sentiment: 'negative',
          mentions: [
            {
              ...mention,
              sentences: [2],
            },
          ],
          urgent: null,
        },
        normalization: {
          flags: ['mentions_capped', 'mentions_merged', 'sentence_refs_repaired'],
          droppedMentionCount: 0,
        },
      },
    })
    expect(thing).toHaveLength(60)
    expect(outbound.calls).toHaveLength(1)
  })
})

describe('Anthropic pinned transport policy', () => {
  it('pins HTTP/1 one-request limits and forbids private addresses', () => {
    expect(PINNED_ANTHROPIC_DISPATCHER_LIMITS).toMatchObject({
      allowH2: false,
      connections: 1,
      pipelining: 0,
      maxRequestsPerClient: 1,
    })
    expect(isForbiddenAnthropicAddress('127.0.0.1')).toBe(true)
    expect(isForbiddenAnthropicAddress('8.8.8.8')).toBe(false)
  })

  it('restricts resolution to api.anthropic.com', () => {
    const resolver = vi.fn((_hostname, _options, callback) =>
      callback(null, [{ address: '8.8.8.8', family: 4 }]),
    )
    const lookup = createRestrictedAnthropicLookup(resolver)
    const accepted = vi.fn()
    lookup('api.anthropic.com', { family: 4 }, accepted)
    expect(accepted).toHaveBeenCalledWith(null, '8.8.8.8', 4)
    const refused = vi.fn()
    lookup('elsewhere.invalid', {}, refused)
    expect((refused.mock.calls[0]?.[0] as Error).message).toBe(
      'Anthropic DNS hostname is forbidden',
    )
  })
})
