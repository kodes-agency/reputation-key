import { describe, expect, it } from 'vitest'
import {
  AI_ADMISSION_RUNTIME_SECRET_NAMES,
  consumeAiAdmissionRuntimeSecrets,
} from './runtime-secrets'

function environment(): Record<string, string | undefined> {
  return Object.fromEntries(
    AI_ADMISSION_RUNTIME_SECRET_NAMES.map((name) => [name, `value-for-${name}`]),
  )
}

describe('AI admission runtime secret environment', () => {
  it('limits raw boot secrets to one callback and clears its aggregate afterward', () => {
    const input = environment()
    input.RELEASE_SHA = 'a'.repeat(40)
    let retained: Record<string, string> | undefined
    const values = consumeAiAdmissionRuntimeSecrets(input, (consumed) => {
      retained = consumed
      return AI_ADMISSION_RUNTIME_SECRET_NAMES.map((name) => consumed[name])
    })
    expect(values).toEqual(
      AI_ADMISSION_RUNTIME_SECRET_NAMES.map((name) => `value-for-${name}`),
    )
    expect(AI_ADMISSION_RUNTIME_SECRET_NAMES.every((name) => !(name in input))).toBe(true)
    expect(input.RELEASE_SHA).toBe('a'.repeat(40))
    expect(Object.values(retained!)).toEqual(
      AI_ADMISSION_RUNTIME_SECRET_NAMES.map(() => ''),
    )
  })

  it('deletes every secret entry when a late required value is missing', () => {
    const input = environment()
    delete input.AI_ADMISSION_ED25519_PRIVATE_KEY_B64

    expect(() => consumeAiAdmissionRuntimeSecrets(input, () => undefined)).toThrow(
      'AI_ADMISSION_ED25519_PRIVATE_KEY_B64',
    )
    expect(AI_ADMISSION_RUNTIME_SECRET_NAMES.every((name) => !(name in input))).toBe(true)
  })

  it('clears the aggregate when derivation throws', () => {
    const input = environment()
    let retained: Record<string, string> | undefined
    expect(() =>
      consumeAiAdmissionRuntimeSecrets(input, (consumed) => {
        retained = consumed
        throw new Error('derivation failed')
      }),
    ).toThrow('derivation failed')
    expect(Object.values(retained!)).toEqual(
      AI_ADMISSION_RUNTIME_SECRET_NAMES.map(() => ''),
    )
    expect(AI_ADMISSION_RUNTIME_SECRET_NAMES.every((name) => !(name in input))).toBe(true)
  })
})
