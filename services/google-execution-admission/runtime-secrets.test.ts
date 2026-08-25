import { describe, expect, it } from 'vitest'
import {
  GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES,
  consumeGoogleAdmissionRuntimeSecrets,
} from './runtime-secrets'

function environment(): Record<string, string | undefined> {
  return Object.fromEntries(
    GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES.map((name) => [name, `value-${name}`]),
  )
}

describe('Google admission runtime secret environment', () => {
  it('limits boot secrets to one callback and clears both source and aggregate', () => {
    const input = environment()
    input.RELEASE_SHA = 'a'.repeat(40)
    let retained: Record<string, string> | undefined
    const values = consumeGoogleAdmissionRuntimeSecrets(input, (secrets) => {
      retained = secrets
      return GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES.map((name) => secrets[name])
    })

    expect(values).toEqual(
      GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES.map((name) => `value-${name}`),
    )
    expect(GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES.every((name) => !(name in input))).toBe(
      true,
    )
    expect(input.RELEASE_SHA).toBe('a'.repeat(40))
    expect(Object.values(retained!)).toEqual(
      GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES.map(() => ''),
    )
  })

  it('clears every secret when derivation fails', () => {
    const input = environment()
    expect(() =>
      consumeGoogleAdmissionRuntimeSecrets(input, () => {
        throw new Error('derivation failed')
      }),
    ).toThrow('derivation failed')
    expect(GOOGLE_ADMISSION_RUNTIME_SECRET_NAMES.every((name) => !(name in input))).toBe(
      true,
    )
  })
})
