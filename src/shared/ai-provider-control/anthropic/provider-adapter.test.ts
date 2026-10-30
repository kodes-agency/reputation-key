import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { maximumCostMicrosWith } from '#/shared/ai-provider-pricing'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING,
  REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
} from '#/shared/review-analysis-v3-profile'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import { GatewayPreparationError } from '../contracts'
import {
  evidencePreparer,
  preparableV3Request,
  v3TestProfile,
} from '../review-evidence.test-fixtures'
import { createAiProviderRegistry } from '../provider-selection'
import {
  createAnthropicProviderAdapter,
  createAnthropicProviderPreparation,
} from './provider-adapter'
import { ANTHROPIC_PRICE_CATALOGUE_V1 } from './request-profile'

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

afterEach(() => vi.restoreAllMocks())

function claimedRequest() {
  const preparation = createAnthropicProviderPreparation()
  const base = preparableV3Request()
  return {
    ...base,
    provider: {
      id: 'anthropic' as const,
      model: preparation.requestProfile.model,
      requestProfileVersion: preparation.requestProfile.version,
      requestProfileDigest: preparation.requestProfile.digest,
    },
  }
}

function prepare() {
  const preparation = createAnthropicProviderPreparation()
  const profile = {
    ...v3TestProfile(),
    attestedProviders: ['anthropic'] as const,
    pairings: { anthropic: REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING },
  }
  const preparer = evidencePreparer({
    profiles: [profile],
    providers: createAiProviderRegistry([preparation]),
  })
  return { preparation, preparer, prepared: preparer.prepare(claimedRequest()) }
}

describe('Anthropic provider preparation', () => {
  it('prepares the real v3 request under Anthropic and sends the paired wire schema', () => {
    const { prepared } = prepare()
    const invocation = prepared.invocation as ReturnType<
      ReturnType<typeof createAnthropicProviderPreparation>['prepare']
    >
    const wireSchema = invocation.sdkRequest.output_config.format.schema
    const digest = createHash('sha256')
      .update('repkey-anthropic-wire-schema-v1\0')
      .update(canonicalizeRfc8785(wireSchema))
      .digest('hex')

    expect(prepared.providerId).toBe('anthropic')
    expect(invocation.descriptor.promptCacheShard).toBe(0)
    expect(invocation.sdkRequest.messages).toHaveLength(1)
    expect(digest).toBe(REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING.schemaTransform.digest)
  })

  it('refuses a request claimed under another provider profile', () => {
    const { preparer } = prepare()
    const request = claimedRequest()
    expect(() =>
      preparer.prepare({
        ...request,
        provider: { ...request.provider, id: 'openai' },
      }),
    ).toThrow(new GatewayPreparationError('provider_profile_changed'))
  })

  it('pins the v3 reservation at the Anthropic price list', () => {
    const { prepared } = prepare()
    expect(
      maximumCostMicrosWith(
        ANTHROPIC_PRICE_CATALOGUE_V1,
        {
          staticTokenBearingBytes:
            REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING.staticTokenBearing.bytes,
          maxOutputTokens: REVIEW_ANALYSIS_V3_LOGICAL_PROFILE.limits.maxOutputTokens,
        },
        prepared.invocation.descriptor.providerPayloadByteCount,
      ),
    ).toBe(3_561)
  })

  it('forwards connector lifecycle and invocation through the provider adapter', async () => {
    const invoke = vi.fn(async () => ({
      disposition: 'success' as const,
      reportedDisposition: 'success' as const,
      result: { invented: true },
      usageKnown: true,
      providerRetryable: false,
      usage: {
        inputTokens: 1,
        cachedTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
        totalTokens: 2,
      },
      retryAfterSeconds: null,
      outboundFetchUsed: true,
    }))
    const close = vi.fn()
    const destroy = vi.fn()
    const adapter = createAnthropicProviderAdapter({
      invoke,
      readiness: () => false,
      close,
      destroy,
    })
    const { prepared } = prepare()

    await expect(
      adapter.invoke(
        prepared.invocation as never,
        {} as never,
        prepared.outputSchema,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ disposition: 'success', result: { invented: true } })
    expect(adapter.readiness?.()).toBe(false)
    await adapter.close?.()
    adapter.destroy?.()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
