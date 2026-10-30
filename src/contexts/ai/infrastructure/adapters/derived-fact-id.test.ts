import { describe, expect, it } from 'vitest'
import { derivedFactId } from './derived-fact-id'

describe('derivedFactId', () => {
  it('is a version-5 UUID with the RFC variant', () => {
    expect(derivedFactId('repkey:test:v1', ['org', 'property', 3])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('names the same fact the same way every time', () => {
    expect(derivedFactId('repkey:test:v1', ['org', 'property', 3])).toBe(
      derivedFactId('repkey:test:v1', ['org', 'property', 3]),
    )
  })

  it('tells facts of different kinds and different parts apart', () => {
    const base = derivedFactId('repkey:test:v1', ['org', 'property', 3])
    expect(derivedFactId('repkey:other:v1', ['org', 'property', 3])).not.toBe(base)
    expect(derivedFactId('repkey:test:v1', ['org', 'property', 4])).not.toBe(base)
    expect(derivedFactId('repkey:test:v1', ['org', 'other', 3])).not.toBe(base)
  })

  it('does not let neighbouring parts run together', () => {
    expect(derivedFactId('repkey:test:v1', ['ab', 'c'])).not.toBe(
      derivedFactId('repkey:test:v1', ['a', 'bc']),
    )
    expect(derivedFactId('repkey:test:v1', [1, 11])).not.toBe(
      derivedFactId('repkey:test:v1', [11, 1]),
    )
  })
})
