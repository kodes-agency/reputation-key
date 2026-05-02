import { validateRating, validateFeedback, validateSource } from './rules'

describe('validateRating', () => {
  it('accepts 1-5', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      expect(validateRating(v).isOk()).toBe(true)
    }
  })

  it('rejects 0', () => {
    expect(validateRating(0).isErr()).toBe(true)
  })

  it('rejects 6', () => {
    expect(validateRating(6).isErr()).toBe(true)
  })
})

describe('validateFeedback', () => {
  it('accepts non-empty text under 1000 chars', () => {
    expect(validateFeedback('Great service!').isOk()).toBe(true)
  })

  it('rejects empty string', () => {
    expect(validateFeedback('').isErr()).toBe(true)
  })

  it('rejects whitespace-only', () => {
    expect(validateFeedback('   ').isErr()).toBe(true)
  })

  it('rejects over 1000 chars', () => {
    expect(validateFeedback('a'.repeat(1001)).isErr()).toBe(true)
  })

  it('accepts exactly 1000 chars', () => {
    expect(validateFeedback('a'.repeat(1000)).isOk()).toBe(true)
  })
})

describe('validateSource', () => {
  it('accepts qr, nfc, direct', () => {
    expect(validateSource('qr').isOk()).toBe(true)
    expect(validateSource('nfc').isOk()).toBe(true)
    expect(validateSource('direct').isOk()).toBe(true)
  })

  it('rejects unknown source', () => {
    expect(validateSource('email').isErr()).toBe(true)
  })
})
