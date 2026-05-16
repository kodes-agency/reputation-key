import { validateRating, validateFeedback, validateSource } from './rules'

describe('validateRating', () => {
  it('accepts 1-5', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      expect(validateRating(v).isOk()).toBe(true)
    }
  })

  it('rejects 0', () => {
    const result = validateRating(0)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_rating')
    }
  })

  it('rejects 6', () => {
    const result = validateRating(6)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_rating')
    }
  })
})

describe('validateFeedback', () => {
  it('accepts non-empty text under 1000 chars', () => {
    expect(validateFeedback('Great service!').isOk()).toBe(true)
  })

  it('rejects empty string', () => {
    const result = validateFeedback('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('feedback_empty')
    }
  })

  it('rejects whitespace-only', () => {
    const result = validateFeedback('   ')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('feedback_empty')
    }
  })

  it('rejects over 1000 chars', () => {
    const result = validateFeedback('a'.repeat(1001))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('feedback_too_long')
    }
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
    const result = validateSource('email')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_source')
    }
  })
})
