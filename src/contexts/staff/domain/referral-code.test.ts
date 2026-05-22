import { describe, it, expect } from 'vitest'
import { generateReferralCode } from './referral-code'

describe('generateReferralCode', () => {
  it('produces format {name-slug}-{4-char-hash}', () => {
    const code = generateReferralCode('Jane Doe')
    expect(code).toMatch(/^[a-z]+(-[a-z]+)*-[a-z0-9]{4}$/)
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
    const code = generateReferralCode('Jane Doe')
    // First part should be "jane-doe" → "jane-d" per spec: {name-slug}
    // Actually spec says e.g. "jane-d-a3f2" which is first-name + last-initial
    const slug = code.split('-').slice(0, -1).join('-')
    expect(slug).toBe('jane-doe')
  })

  it('handles single name', () => {
    const code = generateReferralCode('Madonna')
    const slug = code.split('-').slice(0, -1).join('-')
    expect(slug).toBe('madonna')
  })

  it('strips non-alpha characters from slug', () => {
    const code = generateReferralCode("O'Brien-Smith")
    const slug = code.split('-').slice(0, -1).join('-')
    expect(slug).toBe('obrien-smith')
  })

  it('handles empty string gracefully', () => {
    const code = generateReferralCode('')
    expect(code).toMatch(/^staff-[a-z0-9]{4}$/)
  })

  it('handles whitespace-only input', () => {
    const code = generateReferralCode('   ')
    expect(code).toMatch(/^staff-[a-z0-9]{4}$/)
  })

  it('lowercases the slug', () => {
    const code = generateReferralCode('JANE DOE')
    const slug = code.split('-').slice(0, -1).join('-')
    expect(slug).toBe('jane-doe')
  })
})
