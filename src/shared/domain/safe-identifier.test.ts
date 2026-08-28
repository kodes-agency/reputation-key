import { describe, expect, it } from 'vitest'
import { isSafeOpaqueIdentifier } from './safe-identifier'

describe('safe opaque identifier', () => {
  it.each([
    'user_2wYpR8kF',
    'organization:hotel/eu-1',
    '90000000-0000-4000-8000-000000000001',
    'actor@example.test',
  ])('accepts bounded transport-safe identifier %s', (value) => {
    expect(isSafeOpaqueIdentifier(value)).toBe(true)
  })

  it.each([
    '',
    'contains a space',
    'line\nbreak',
    'tab\tvalue',
    'x'.repeat(256),
    null,
    42,
  ])('rejects unsafe identifier %p', (value) => {
    expect(isSafeOpaqueIdentifier(value)).toBe(false)
  })
})
