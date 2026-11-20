import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OPENAI_PRICE_CATALOGUE_V2 } from '#/shared/ai-openai-provider-profile'

/**
 * PostgreSQL owns the charge. Keep rates in the provider catalogue so repricing
 * cannot leave copied prices in the authority or its fixtures. The gateway
 * accepts the authority's cost without recomputing it.
 */
const COST_CRITICAL_SOURCES = [
  'src/shared/ai-provider-control/service.ts',
  'src/contexts/ai/execution/ai-execution-admission.adapter.server.ts',
  // The fakes belong here too: both stood in for the real admission authority
  // while pricing differently from it, which is precisely how the repricing
  // shipped with green tests.
  'src/shared/ai-provider-control/service-orchestration.test.ts',
] as const

/** Every per-million rate in the catalogue, in the spellings TS allows. */
const CATALOGUE_RATES = [
  OPENAI_PRICE_CATALOGUE_V2.uncachedInputMicros,
  OPENAI_PRICE_CATALOGUE_V2.cachedInputMicros,
  OPENAI_PRICE_CATALOGUE_V2.outputMicros,
  OPENAI_PRICE_CATALOGUE_V2.unitTokens,
  // The pre-Luna rates, named so a revert is caught as loudly as a drift.
  750_000,
  75_000,
  4_500_000,
] as const

/**
 * A number that is also a rate, and means something else in that file. The input rate
 * of `gpt-6-luna` ($0.10 per million, 100_000 micros) is the gateway's outer horizon for
 * a trend attempt in milliseconds (`isGatewayOuterDeadlineValid`), which the notice
 * states as "a 100-second outer attempt deadline". Name each one, with its meaning, so
 * a real price literal in the same file still fails.
 */
const COINCIDENCES: Readonly<Partial<Record<string, readonly number[]>>> = {
  'src/shared/ai-provider-control/service.ts': [100_000],
}

describe('AI price literals', () => {
  it.each(COST_CRITICAL_SOURCES)(
    '%s holds no per-million price literal of its own',
    (file) => {
      const source = readFileSync(file, 'utf8')
      // Any bare per-million rate here is a second source of truth. The rates
      // live in OPENAI_PRICE_CATALOGUE_V2 and reach these files only through
      // settledCostMicros.
      const found = CATALOGUE_RATES.filter((rate) => {
        if (COINCIDENCES[file]?.includes(rate)) return false
        const grouped = rate.toLocaleString('en-US').replaceAll(',', '_')
        return (
          new RegExp(`\\b${grouped}n?\\b`).test(source) ||
          new RegExp(`\\b${rate}n?\\b`).test(source)
        )
      })
      expect(found).toEqual([])
      if (file === 'src/shared/ai-provider-control/service.ts') {
        expect(source).not.toContain('settledCostMicros')
      } else {
        expect(source).toContain('settledCostMicros')
      }
    },
  )
})
