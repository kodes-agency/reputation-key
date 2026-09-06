import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  OPENAI_PRICE_CATALOGUE_V1,
  settledCostMicros,
} from './ai-openai-provider-profile'

/**
 * The admission authority signs `costMicros`; the egress gateway independently
 * recomputes it and refuses any receipt that disagrees. They MUST derive it from
 * the same catalogue.
 *
 * They did not. The gateway carried its own per-million literals, so repricing
 * the model to gpt-5.6-luna made every settled reply fail receipt verification
 * AFTER the provider had run and been charged, surfacing to the operator as
 * "A suggestion is unavailable right now."
 */
const COST_CRITICAL_SOURCES = [
  'src/shared/ai-provider-control/service.ts',
  'src/shared/ai-provider-control/postgres-admission-authority.ts',
  // The fakes belong here too: both stood in for the real admission authority
  // while pricing differently from it, which is precisely how the repricing
  // shipped with green tests.
  'src/shared/ai-provider-control/service-orchestration.test.ts',
] as const

/** Every per-million rate in the catalogue, in the spellings TS allows. */
const CATALOGUE_RATES = [
  OPENAI_PRICE_CATALOGUE_V1.uncachedInputMicros,
  OPENAI_PRICE_CATALOGUE_V1.cachedInputMicros,
  OPENAI_PRICE_CATALOGUE_V1.outputMicros,
  OPENAI_PRICE_CATALOGUE_V1.unitTokens,
  // The pre-Luna rates, named so a revert is caught as loudly as a drift.
  750_000,
  75_000,
  4_500_000,
] as const

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
      BigInt(OPENAI_PRICE_CATALOGUE_V1.uncachedInputMicros) +
        BigInt(OPENAI_PRICE_CATALOGUE_V1.outputMicros),
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
    expect(allUncached).toBe(BigInt(OPENAI_PRICE_CATALOGUE_V1.uncachedInputMicros))
    expect(allCached).toBe(BigInt(OPENAI_PRICE_CATALOGUE_V1.cachedInputMicros))
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

  it.each(COST_CRITICAL_SOURCES)(
    '%s holds no per-million price literal of its own',
    (file) => {
      const source = readFileSync(file, 'utf8')
      // Any bare per-million rate here is a second source of truth. The rates
      // live in OPENAI_PRICE_CATALOGUE_V1 and reach these files only through
      // settledCostMicros.
      const found = CATALOGUE_RATES.filter((rate) => {
        const grouped = rate.toLocaleString('en-US').replaceAll(',', '_')
        return (
          new RegExp(`\\b${grouped}n?\\b`).test(source) ||
          new RegExp(`\\b${rate}n?\\b`).test(source)
        )
      })
      expect(found).toEqual([])
      expect(source).toContain('settledCostMicros')
    },
  )
})
