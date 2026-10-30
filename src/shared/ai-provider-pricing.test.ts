import { describe, expect, it } from 'vitest'
import {
  OPENAI_PRICE_CATALOGUE_V1,
  maximumCostMicros,
  settledCostMicros,
} from './ai-openai-provider-profile'
import {
  maximumCostMicrosWith,
  settledCostMicrosWith,
  type AiProviderPriceCatalogue,
} from './ai-provider-pricing'
import {
  AI_PROVIDER_PRICE_CATALOGUES,
  priceCatalogueOfProvider,
} from './ai-provider-pricing-registry'

const SYNTHETIC: AiProviderPriceCatalogue = Object.freeze({
  catalogueId: 'synthetic-test-prices',
  modelSnapshot: 'synthetic-model',
  unitTokens: 1_000_000,
  uncachedInputMicros: 3_000_000,
  cachedInputMicros: 300_000,
  outputMicros: 15_000_000,
  sourceUrl: 'https://example.invalid/pricing',
  retrievalDate: '2026-10-29',
})

describe('provider price formulas', () => {
  const profiles = [
    { staticTokenBearingBytes: 0, maxOutputTokens: 0 },
    { staticTokenBearingBytes: 419, maxOutputTokens: 512 },
    { staticTokenBearingBytes: 2_193, maxOutputTokens: 1_024 },
    { staticTokenBearingBytes: 9_999, maxOutputTokens: 4_096 },
  ]
  const payloads = [0, 1, 80, 1_455, 16_384, 57_344]
  const usages = [
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    { inputTokens: 1_000, cachedInputTokens: 1_000, outputTokens: 0 },
    { inputTokens: 123_457, cachedInputTokens: 99_999, outputTokens: 4_097 },
  ]

  it("gives OpenAI's catalogue exactly the numbers OpenAI's own functions always gave", () => {
    for (const profile of profiles) {
      for (const bytes of payloads) {
        expect(maximumCostMicrosWith(OPENAI_PRICE_CATALOGUE_V1, profile, bytes)).toBe(
          maximumCostMicros(profile, bytes),
        )
      }
    }
    for (const usage of usages) {
      expect(settledCostMicrosWith(OPENAI_PRICE_CATALOGUE_V1, usage)).toBe(
        settledCostMicros(usage),
      )
    }
  })

  it('pins what the live catalogue reserves and settles', () => {
    // The figures the v2 descriptors carry (`openai-v2-parity.test.ts` pins them
    // in the descriptors themselves).
    expect(
      maximumCostMicros({ staticTokenBearingBytes: 2_193, maxOutputTokens: 1_024 }, 80),
    ).toBe(1_684)
    expect(
      settledCostMicros({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }),
    ).toBe(2n)
  })

  it('prices a call with the catalogue it is given and no other', () => {
    const profile = { staticTokenBearingBytes: 2_000, maxOutputTokens: 1_000 }
    const usage = { inputTokens: 10_000, cachedInputTokens: 4_000, outputTokens: 500 }

    expect(maximumCostMicrosWith(SYNTHETIC, profile, 1_000)).toBe(
      // (3,000 input tokens x 3,000,000 + 1,000 output x 15,000,000) / 1,000,000
      9_000 + 15_000,
    )
    expect(settledCostMicrosWith(SYNTHETIC, usage)).toBe(
      // (6,000 x 3,000,000 + 4,000 x 300,000 + 500 x 15,000,000) / 1,000,000
      18_000n + 1_200n + 7_500n,
    )
    expect(settledCostMicrosWith(SYNTHETIC, usage)).not.toBe(
      settledCostMicrosWith(OPENAI_PRICE_CATALOGUE_V1, usage),
    )
  })

  it('rounds a partial micro up, never down', () => {
    const catalogue = { ...SYNTHETIC, uncachedInputMicros: 1, outputMicros: 1 }
    expect(
      settledCostMicrosWith(catalogue, {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(1n)
    expect(
      maximumCostMicrosWith(
        catalogue,
        { staticTokenBearingBytes: 1, maxOutputTokens: 0 },
        0,
      ),
    ).toBe(1)
  })

  it('refuses inputs no usage or profile can hold, with the messages it always had', () => {
    expect(() =>
      maximumCostMicrosWith(
        SYNTHETIC,
        { staticTokenBearingBytes: -1, maxOutputTokens: 1 },
        1,
      ),
    ).toThrow('AI maximum cost inputs must be nonnegative safe integers')
    expect(() =>
      maximumCostMicrosWith(
        SYNTHETIC,
        { staticTokenBearingBytes: 1, maxOutputTokens: 1 },
        Number.MAX_SAFE_INTEGER + 1,
      ),
    ).toThrow('AI maximum cost inputs must be nonnegative safe integers')
    expect(() =>
      maximumCostMicrosWith(
        { ...SYNTHETIC, outputMicros: Number.MAX_SAFE_INTEGER },
        { staticTokenBearingBytes: 0, maxOutputTokens: Number.MAX_SAFE_INTEGER },
        0,
      ),
    ).toThrow('AI maximum cost exceeds the safe integer range')
    expect(() =>
      settledCostMicrosWith(SYNTHETIC, {
        inputTokens: 1,
        cachedInputTokens: 2,
        outputTokens: 0,
      }),
    ).toThrow('AI settled usage must be nonnegative safe integers')
    expect(() =>
      settledCostMicrosWith(SYNTHETIC, {
        inputTokens: 1.5,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toThrow('AI settled usage must be nonnegative safe integers')
  })
})

describe('the price list of each provider', () => {
  it('holds OpenAI, and an operation that records no provider is OpenAI', () => {
    expect(priceCatalogueOfProvider('openai')).toBe(OPENAI_PRICE_CATALOGUE_V1)
    expect(priceCatalogueOfProvider(null)).toBe(OPENAI_PRICE_CATALOGUE_V1)
    expect(Object.keys(AI_PROVIDER_PRICE_CATALOGUES)).toEqual(['openai'])
    expect(Object.isFrozen(AI_PROVIDER_PRICE_CATALOGUES)).toBe(true)
  })

  it('prices no provider it holds no list for, and falls back to nothing', () => {
    expect(priceCatalogueOfProvider('anthropic')).toMatchObject({
      catalogueId: 'anthropic-claude-haiku-5-5-standard-2026-10-30',
      modelSnapshot: 'claude-haiku-5-5',
    })
    for (const unknown of [
      '',
      'google',
      'OpenAI',
      'toString',
      '__proto__',
      'constructor',
    ]) {
      expect(priceCatalogueOfProvider(unknown)).toBeNull()
    }
  })
})
