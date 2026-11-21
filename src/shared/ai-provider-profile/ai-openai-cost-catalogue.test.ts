import { describe, expect, it } from 'vitest'
import {
  AI_SERVICE_DRAIN_SECONDS_V1,
  AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1,
  maximumCostMicros,
  OPENAI_PRICE_CATALOGUE_V2,
} from './ai-openai-provider-profile'
import { maximumCostMicrosWith } from './ai-provider-pricing'

const routeProfile = Object.freeze({
  staticTokenBearingBytes: 1_000,
  maxOutputTokens: 4_096,
})

describe('OpenAI maximum cost catalogue', () => {
  it('uses the pinned uncached-input and output rates with integer ceiling division', () => {
    expect(OPENAI_PRICE_CATALOGUE_V2).toMatchObject({
      unitTokens: 1_000_000,
      uncachedInputMicros: 100_000,
      cachedInputMicros: 10_000,
      outputMicros: 500_000,
    })
    // Deliberately a literal, not derived from the catalogue: this pins the ceiling
    // division itself, and deriving it would make the assertion tautological.
    // floor(((1_000 + 16_384) * 100_000 + 4_096 * 500_000 + 999_999) / 1_000_000)
    //   = floor(3_787_399_999 / 1_000_000) = 3_787
    expect(maximumCostMicros(routeProfile, 16_384)).toBe(3_787)
    expect(maximumCostMicros({ staticTokenBearingBytes: 0, maxOutputTokens: 0 }, 1)).toBe(
      1,
    )
  })

  it('leaves a bounded cleanup margin after the longest request handler drains', () => {
    const deploymentDrainMillis = AI_SERVICE_DRAIN_SECONDS_V1 * 1_000
    expect(AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1).toBeLessThan(deploymentDrainMillis)
    expect(
      deploymentDrainMillis - AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1,
    ).toBeGreaterThanOrEqual(10_000)
  })

  it.each([
    [{ staticTokenBearingBytes: -1, maxOutputTokens: 1 }, 1],
    [{ staticTokenBearingBytes: 1, maxOutputTokens: -1 }, 1],
    [{ staticTokenBearingBytes: 1.5, maxOutputTokens: 1 }, 1],
    [{ staticTokenBearingBytes: 1, maxOutputTokens: 1 }, -1],
    [{ staticTokenBearingBytes: 1, maxOutputTokens: 1 }, Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects unsafe or negative inputs %#', (profile, payloadBytes) => {
    expect(() => maximumCostMicros(profile, payloadBytes)).toThrow(RangeError)
  })

  it('rejects a valid-input calculation whose result cannot be represented safely', () => {
    const extreme = {
      staticTokenBearingBytes: Number.MAX_SAFE_INTEGER,
      maxOutputTokens: Number.MAX_SAFE_INTEGER,
    }
    // At the pinned rates the largest valid input costs 0.7 of the largest safe
    // integer, so only a dearer list can overflow: the guard is the shared formula's.
    expect(
      Number.isSafeInteger(maximumCostMicros(extreme, Number.MAX_SAFE_INTEGER)),
    ).toBe(true)
    expect(() =>
      maximumCostMicrosWith(
        {
          ...OPENAI_PRICE_CATALOGUE_V2,
          uncachedInputMicros: 1_200_000,
          outputMicros: 1_200_000,
        },
        extreme,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrow(/safe integer range/)
  })
})
