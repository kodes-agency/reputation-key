import { describe, expect, it } from 'vitest'
import { normalizeGoogleReviewDestination } from './google-review-destination'

describe('Google review destination', () => {
  it.each([
    'https://search.google.com/local/writereview?placeid=abc123',
    'https://www.google.com/maps/place/example',
    'https://maps.google.com/?cid=123',
    'https://g.page/r/example/review',
  ])('accepts a provider-supplied Google HTTPS destination: %s', (uri) => {
    expect(normalizeGoogleReviewDestination(uri)).toBe(uri)
  })

  it.each([
    'http://search.google.com/local/writereview?placeid=abc123',
    'https://evil.example/review',
    'https://google.com.evil.example/review',
    'https://user:password@search.google.com/review',
    'https://search.google.com/review\n',
    'not-a-url',
  ])('rejects an unsafe or non-Google destination: %s', (uri) => {
    expect(normalizeGoogleReviewDestination(uri)).toBeNull()
  })
})
