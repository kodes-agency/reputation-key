import { describe, expect, it } from 'vitest'
import { isSensitiveObservabilityField } from './sensitive-field-policy'

describe('observability sensitive-field policy', () => {
  it.each([
    'password',
    'password_hash',
    'clientSecret',
    'OPENAI_API_KEY',
    'contactEmail',
    'DATABASE_URL',
    'review_text',
    'oauthStateHandleDigest',
  ])('normalizes and protects %s', (field) => {
    expect(isSensitiveObservabilityField(field)).toBe(true)
  })

  it.each(['outcomeCode', 'tokenCount', 'emailDeliveryEnabled', 'useCase', 'queue'])(
    'keeps content-free operational field %s observable',
    (field) => {
      expect(isSensitiveObservabilityField(field)).toBe(false)
    },
  )
})
