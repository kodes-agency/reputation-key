import { describe, expect, it } from 'vitest'
import {
  AI_SERVICE_DRAIN_SECONDS_V1,
  AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1,
  maximumCostMicros,
  OPENAI_PRICE_CATALOGUE_V1,
} from './ai-openai-provider-profile'

const routeProfile = Object.freeze({
  staticTokenBearingBytes: 1_000,
  maxOutputTokens: 4_096,
})

describe('OpenAI maximum cost catalogue', () => {
  it('uses the pinned uncached-input and output rates with integer ceiling division', () => {
    expect(OPENAI_PRICE_CATALOGUE_V1).toMatchObject({
      unitTokens: 1_000_000,
      uncachedInputMicros: 750_000,
      cachedInputMicros: 75_000,
      outputMicros: 4_500_000,
    })
    expect(maximumCostMicros(routeProfile, 16_384)).toBe(31_470)
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
    expect(() =>
      maximumCostMicros(
        {
          staticTokenBearingBytes: Number.MAX_SAFE_INTEGER,
          maxOutputTokens: Number.MAX_SAFE_INTEGER,
        },
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrow(/safe integer range/)
  })
})
