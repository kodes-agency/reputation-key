import { describe, expect, it } from 'vitest'
import { maxSimilarity, replySimilarity } from './reply-similarity'

describe('reply similarity', () => {
  it('normalizes punctuation, case, and the greeting first name', () => {
    expect(
      replySimilarity(
        'Hi Maria,\n\nThank you for staying with us. We hope to see you again.',
        'Hello Alex! Thank you for staying with us; we hope to see you again!',
      ),
    ).toBe(1)
  })

  it('uses normalized token trigram Jaccard similarity', () => {
    expect(replySimilarity('one two three four', 'one two three five')).toBeCloseTo(1 / 3)
  })

  it('does not discard the first body word after a name-free greeting', () => {
    expect(
      replySimilarity(
        'Hello,\n\nThank you for staying with us.',
        'Hi Maria,\n\nThank you for staying with us.',
      ),
    ).toBe(1)
  })

  it('returns the maximum without exposing a matching reply', () => {
    expect(
      maxSimilarity('one two three four', ['other words only', 'one two three five']),
    ).toBeCloseTo(1 / 3)
    expect(maxSimilarity('anything', [])).toBe(0)
  })
})
