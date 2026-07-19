// Known-answer tests for the vendored browser-safe SHA-256.
// Vectors: FIPS 180-4 examples + node:crypto reference outputs.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { sha256Hex } from './sha256'

const reference = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex')

describe('sha256Hex (browser-safe)', () => {
  it('empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('FIPS vector "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('FIPS multi-block vector (56 bytes)', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('exactly 64 bytes (one full block, exercises padding block)', () => {
    const input = 'a'.repeat(64)
    expect(sha256Hex(input)).toBe(reference(input))
  })

  it('exactly 55 bytes (padding boundary)', () => {
    const input = 'a'.repeat(55)
    expect(sha256Hex(input)).toBe(reference(input))
  })

  it('UTF-8 multibyte content matches node:crypto', () => {
    const input = 'Röse ★ 日本語 — reputation'
    expect(sha256Hex(input)).toBe(reference(input))
  })

  it('a long JSON payload matches node:crypto', () => {
    const input = JSON.stringify({
      platform: 'google',
      externalId: 'review-12345',
      rating: 5,
      text: 'Great service — émigré façade',
    })
    expect(sha256Hex(input)).toBe(reference(input))
  })
})
