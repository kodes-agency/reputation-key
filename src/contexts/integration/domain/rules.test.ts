// Integration context — domain rules tests
// Per architecture: "Pure unit, no setup, no mocks. Run in milliseconds."

import { describe, it, expect } from 'vitest'
import { isValidEmail, isValidVisibility } from './rules'

// ── isValidEmail ──────────────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts a standard email', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
  })

  it('accepts subdomain email', () => {
    expect(isValidEmail('user@mail.example.com')).toBe(true)
  })

  it('accepts plus addressing', () => {
    expect(isValidEmail('user+tag@example.com')).toBe(true)
  })

  it('accepts dash in local part', () => {
    expect(isValidEmail('user-name@example.com')).toBe(true)
  })

  it('rejects missing @', () => {
    expect(isValidEmail('userexample.com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false)
  })

  it('rejects spaces around @', () => {
    expect(isValidEmail('user @example.com')).toBe(false)
  })

  it('rejects missing domain', () => {
    expect(isValidEmail('user@')).toBe(false)
  })

  it('rejects missing TLD', () => {
    expect(isValidEmail('user@example')).toBe(false)
  })

  it('rejects double @', () => {
    expect(isValidEmail('user@@example.com')).toBe(false)
  })

  it('rejects @ at start', () => {
    expect(isValidEmail('@example.com')).toBe(false)
  })

  it('rejects trailing dot in TLD with space', () => {
    expect(isValidEmail('user@example .com')).toBe(false)
  })

  it('rejects whitespace-only string', () => {
    expect(isValidEmail('   ')).toBe(false)
  })
})

// ── isValidVisibility ─────────────────────────────────────────────

describe('isValidVisibility', () => {
  it('accepts "private"', () => {
    expect(isValidVisibility('private')).toBe(true)
  })

  it('accepts "organization"', () => {
    expect(isValidVisibility('organization')).toBe(true)
  })

  it('rejects "public"', () => {
    expect(isValidVisibility('public')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidVisibility('')).toBe(false)
  })

  it('rejects uppercase', () => {
    expect(isValidVisibility('Private')).toBe(false)
  })

  it('rejects "PRIVATE"', () => {
    expect(isValidVisibility('PRIVATE')).toBe(false)
  })

  it('rejects whitespace-padded value', () => {
    expect(isValidVisibility(' private ')).toBe(false)
  })

  it('narrows type on truthy return', () => {
    const value = 'private' as string
    if (isValidVisibility(value)) {
      // TypeScript narrows to GoogleConnectionVisibility here
      const _assigned: 'private' | 'organization' = value
      expect(_assigned).toBe('private')
    }
  })
})
