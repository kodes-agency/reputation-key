import { describe, expect, it } from 'vitest'
import {
  AI_GATEWAY_RUNTIME_SECRET_NAMES,
  consumeAiGatewayRuntimeSecrets,
} from './runtime-secrets'

function environment(): Record<string, string | undefined> {
  return Object.fromEntries(
    AI_GATEWAY_RUNTIME_SECRET_NAMES.map((name) => [name, `value-for-${name}`]),
  )
}

describe('AI gateway runtime secret environment', () => {
  it('limits raw boot secrets to one callback and clears its aggregate afterward', () => {
    const input = environment()
    input.RELEASE_SHA = 'a'.repeat(40)
    let retained: Record<string, string> | undefined
    const values = consumeAiGatewayRuntimeSecrets(input, (consumed) => {
      retained = consumed
      return AI_GATEWAY_RUNTIME_SECRET_NAMES.map((name) => consumed[name])
    })
    expect(values).toEqual(
      AI_GATEWAY_RUNTIME_SECRET_NAMES.map((name) => `value-for-${name}`),
    )
    expect(AI_GATEWAY_RUNTIME_SECRET_NAMES.every((name) => !(name in input))).toBe(true)
    expect(input.RELEASE_SHA).toBe('a'.repeat(40))
    expect(Object.values(retained!)).toEqual(
      AI_GATEWAY_RUNTIME_SECRET_NAMES.map(() => ''),
    )
  })

  it('deletes every secret entry when a late required value is missing', () => {
    const input = environment()
    delete input.AI_PROVENANCE_ED25519_PRIVATE_KEY_B64

    expect(() => consumeAiGatewayRuntimeSecrets(input, () => undefined)).toThrow(
      'AI_PROVENANCE_ED25519_PRIVATE_KEY_B64',
    )
    expect(AI_GATEWAY_RUNTIME_SECRET_NAMES.every((name) => !(name in input))).toBe(true)
  })

  it('clears the aggregate when derivation throws', () => {
    const input = environment()
    let retained: Record<string, string> | undefined
    expect(() =>
      consumeAiGatewayRuntimeSecrets(input, (consumed) => {
        retained = consumed
        throw new Error('derivation failed')
      }),
    ).toThrow('derivation failed')
    expect(Object.values(retained!)).toEqual(
      AI_GATEWAY_RUNTIME_SECRET_NAMES.map(() => ''),
    )
    expect(AI_GATEWAY_RUNTIME_SECRET_NAMES.every((name) => !(name in input))).toBe(true)
  })
})
