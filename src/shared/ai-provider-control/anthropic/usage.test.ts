import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING } from '#/shared/review-analysis-v3-profile'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import {
  evidencePreparer,
  preparableV3Request,
  v3TestProfile,
} from '../review-evidence.test-fixtures'
import { createAiProviderRegistry } from '../provider-selection'
import type { PreparedAnthropicInvocation } from './prepared-invocation'
import { createAnthropicProviderPreparation } from './provider-adapter'
import { parseAnthropicUsage } from './usage'

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

function invocation(): PreparedAnthropicInvocation {
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
  }).prepare(request).invocation as PreparedAnthropicInvocation
}

describe('Anthropic usage normalization', () => {
  it('adds ordinary, cache-read and cache-write input without double-counting thinking', () => {
    expect(
      parseAnthropicUsage(
        {
          input_tokens: 10,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 2,
          output_tokens: 8,
          output_tokens_details: { thinking_tokens: 5 },
          ignored: true,
        },
        invocation(),
      ),
    ).toEqual({
      inputTokens: 15,
      cachedTokens: 3,
      outputTokens: 8,
      reasoningTokens: 5,
      totalTokens: 23,
    })
  })

  it('accepts the input ceiling and rejects one token above it', () => {
    const prepared = invocation()
    const ceiling =
      REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING.staticTokenBearing.bytes +
      prepared.descriptor.providerPayloadByteCount
    expect(
      parseAnthropicUsage({ input_tokens: ceiling, output_tokens: 1 }, prepared),
    ).toMatchObject({ inputTokens: ceiling })
    expect(
      parseAnthropicUsage({ input_tokens: ceiling + 1, output_tokens: 1 }, prepared),
    ).toBeNull()
  })

  it.each([
    [
      {
        input_tokens: 1,
        output_tokens: 2,
        output_tokens_details: { thinking_tokens: 3 },
      },
    ],
    [{ input_tokens: 1, output_tokens: 4_097 }],
    [{ input_tokens: -1, output_tokens: 1 }],
    [{ input_tokens: 1.5, output_tokens: 1 }],
  ])('rejects a usage block that violates an invariant', (usage) => {
    expect(parseAnthropicUsage(usage, invocation())).toBeNull()
  })
})
