import { describe, expect, it } from 'vitest'
import {
  OPENAI_PRICE_CATALOGUE_V2,
  settledCostMicros,
} from './ai-openai-provider-profile'

describe('settled cost agreement', () => {
  it('derives the charge from the catalogue, not from copied literals', () => {
    // 1M uncached input + 1M output at the current catalogue.
    expect(
      settledCostMicros({
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
      }),
    ).toBe(
      BigInt(OPENAI_PRICE_CATALOGUE_V2.uncachedInputMicros) +
        BigInt(OPENAI_PRICE_CATALOGUE_V2.outputMicros),
    )
  })

  it('prices cached input separately from uncached input', () => {
    const allUncached = settledCostMicros({
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 0,
    })
    const allCached = settledCostMicros({
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    })
    expect(allUncached).toBe(BigInt(OPENAI_PRICE_CATALOGUE_V2.uncachedInputMicros))
    expect(allCached).toBe(BigInt(OPENAI_PRICE_CATALOGUE_V2.cachedInputMicros))
    expect(allCached).toBeLessThan(allUncached)
  })

  it('charges partial micros rather than dropping them', () => {
    expect(
      settledCostMicros({ inputTokens: 1, cachedInputTokens: 0, outputTokens: 0 }),
    ).toBe(1n)
  })

  it('rejects usage that cannot be a real settlement', () => {
    expect(() =>
      settledCostMicros({ inputTokens: 1, cachedInputTokens: 2, outputTokens: 0 }),
    ).toThrow(RangeError)
    expect(() =>
      settledCostMicros({ inputTokens: -1, cachedInputTokens: 0, outputTokens: 0 }),
    ).toThrow(RangeError)
  })
})
