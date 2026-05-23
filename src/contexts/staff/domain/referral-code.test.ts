import { describe, it, expect } from 'vitest'
import { generateReferralCode } from './referral-code'

/** Deterministic stub: always returns 2 bytes of 0xab → hash "abab" */
const stubRandomBytes = (size: number) => Buffer.alloc(size, 0xab)

describe('generateReferralCode', () => {
  it('produces format {name-slug}-{4-char-hash}', () => {
    const code = generateReferralCode('Jane Doe', stubRandomBytes)
    expect(code).toBe('jane-doe-abab')
  })

  it('generates different codes for same name (random hash)', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 50; i++) {
      codes.add(generateReferralCode('Jane Doe'))
    }
    // With 4 hex chars (65536 space), 50 samples should produce >1 unique codes
    expect(codes.size).toBeGreaterThan(1)
  })

  it('uses first initial + last name for full names', () => {
    const code = generateReferralCode('Jane Doe', stubRandomBytes)
    const slug = code.split('-').slice(0, -1).join('-')
    expect(slug).toBe('jane-doe')
  })

  it('handles single name', () => {
    const code = generateReferralCode('Madonna', stubRandomBytes)
    const slug = code.split('-').slice(0, -1).join('-')
    expect(slug).toBe('madonna')
  })

  it('strips non-alpha characters from slug', () => {
    const code = generateReferralCode("O'Brien-Smith", stubRandomBytes)
    const slug = code.split('-').slice(0, -1).join('-')
    expect(slug).toBe('obrien-smith')
  })

  it('handles empty string gracefully', () => {
    const code = generateReferralCode('', stubRandomBytes)
    expect(code).toBe('staff-abab')
  })

  it('handles whitespace-only input', () => {
    const code = generateReferralCode('   ', stubRandomBytes)
    expect(code).toBe('staff-abab')
  })

  it('lowercases the slug', () => {
    const code = generateReferralCode('JANE DOE', stubRandomBytes)
    const slug = code.split('-').slice(0, -1).join('-')
    expect(slug).toBe('jane-doe')
  })
})
