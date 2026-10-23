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

  // A print code is a credential, and so is the hash a lookup is made by
  // (ADR 0069, Portal invariant 9): either one would find a Portal.
  it.each([
    'printCode',
    'print_code',
    'qrPrintCode',
    'nfcPrintCode',
    'PRINT-CODE',
    'printCodeHash',
    'qrPrintCodeHash',
    'nfcPrintCodeHash',
    'qr_print_code_hash',
    'shortCodeHash',
  ])('protects the print code field %s', (field) => {
    expect(isSensitiveObservabilityField(field)).toBe(true)
  })

  it.each([
    'outcomeCode',
    'tokenCount',
    'emailDeliveryEnabled',
    'useCase',
    'queue',
    'addressShape',
    'symbolVersion',
  ])('keeps content-free operational field %s observable', (field) => {
    expect(isSensitiveObservabilityField(field)).toBe(false)
  })
})
