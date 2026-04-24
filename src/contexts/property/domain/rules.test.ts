// Property context — domain rules tests
// Per architecture: "Pure unit, no setup, no mocks. Run in milliseconds."
// 100% coverage on rules.

import { describe, it, expect } from 'vitest'
import {
  normalizeSlug,
  validateSlug,
  validatePropertyName,
  validateTimezone,
  canCreateProperties,
  canEditProperties,
  canDeleteProperties,
} from './rules'
import { VALID_TIMEZONES } from '#/shared/domain/timezones'

// ── normalizeSlug ──────────────────────────────────────────────────

describe('normalizeSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(normalizeSlug('Grand Hotel')).toBe('grand-hotel')
  })

  it('strips special characters', () => {
    expect(normalizeSlug("O'Brien's Inn!")).toBe('obriens-inn')
  })

  it('replaces multiple spaces with single hyphen', () => {
    expect(normalizeSlug('My   Cool   Place')).toBe('my-cool-place')
  })

  it('collapses multiple hyphens', () => {
    expect(normalizeSlug('a---b')).toBe('a-b')
  })

  it('strips leading and trailing hyphens', () => {
    expect(normalizeSlug('-hello-world-')).toBe('hello-world')
  })

  it('caps at 64 characters', () => {
    expect(normalizeSlug('a'.repeat(100)).length).toBe(64)
  })

  it('handles empty string', () => {
    expect(normalizeSlug('')).toBe('')
  })
})

// ── validateSlug ───────────────────────────────────────────────────

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    expect(validateSlug('grand-hotel').isOk()).toBe(true)
    expect(validateSlug('main-lobby').isOk()).toBe(true)
    expect(validateSlug('abc123').isOk()).toBe(true)
  })

  it('rejects single character slugs', () => {
    const result = validateSlug('a')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_slug')
  })

  it('rejects slugs starting with hyphen', () => {
    const result = validateSlug('-invalid')
    expect(result.isErr()).toBe(true)
  })

  it('rejects slugs ending with hyphen', () => {
    const result = validateSlug('invalid-')
    expect(result.isErr()).toBe(true)
  })

  it('rejects slugs with uppercase', () => {
    const result = validateSlug('Invalid')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_slug')
  })

  it('rejects slugs with spaces', () => {
    const result = validateSlug('hello world')
    expect(result.isErr()).toBe(true)
  })

  it('rejects empty string', () => {
    const result = validateSlug('')
    expect(result.isErr()).toBe(true)
  })
})

// ── validatePropertyName ───────────────────────────────────────────

describe('validatePropertyName', () => {
  it('accepts valid names', () => {
    const result = validatePropertyName('Grand Hotel')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe('Grand Hotel')
  })

  it('trims whitespace', () => {
    const result = validatePropertyName('  Hotel  ')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe('Hotel')
  })

  it('rejects empty name', () => {
    const result = validatePropertyName('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_name')
  })

  it('rejects whitespace-only name', () => {
    const result = validatePropertyName('   ')
    expect(result.isErr()).toBe(true)
  })

  it('rejects name over 100 characters', () => {
    const result = validatePropertyName('a'.repeat(101))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_name')
  })

  it('accepts name at exactly 100 characters', () => {
    const result = validatePropertyName('a'.repeat(100))
    expect(result.isOk()).toBe(true)
  })
})

// ── validateTimezone ───────────────────────────────────────────────

describe('validateTimezone', () => {
  it('accepts valid IANA timezones', () => {
    expect(validateTimezone('America/New_York').isOk()).toBe(true)
    expect(validateTimezone('Europe/London').isOk()).toBe(true)
    expect(validateTimezone('Asia/Tokyo').isOk()).toBe(true)
    expect(validateTimezone('UTC').isOk()).toBe(true)
  })

  it('rejects unknown timezones', () => {
    const result = validateTimezone('Invalid/Zone')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_timezone')
  })

  it('rejects empty string', () => {
    const result = validateTimezone('')
    expect(result.isErr()).toBe(true)
  })

  it('validates all entries in VALID_TIMEZONES are accepted', () => {
    for (const tz of VALID_TIMEZONES) {
      expect(validateTimezone(tz).isOk()).toBe(true)
    }
  })
})

// ── Authorization rules ────────────────────────────────────────────

describe('canCreateProperties', () => {
  it('allows PropertyManager and AccountAdmin', () => {
    expect(canCreateProperties('AccountAdmin')).toBe(true)
    expect(canCreateProperties('PropertyManager')).toBe(true)
  })

  it('rejects Staff', () => {
    expect(canCreateProperties('Staff')).toBe(false)
  })
})

describe('canEditProperties', () => {
  it('allows PropertyManager and AccountAdmin', () => {
    expect(canEditProperties('AccountAdmin')).toBe(true)
    expect(canEditProperties('PropertyManager')).toBe(true)
  })

  it('rejects Staff', () => {
    expect(canEditProperties('Staff')).toBe(false)
  })
})

describe('canDeleteProperties', () => {
  it('allows only AccountAdmin', () => {
    expect(canDeleteProperties('AccountAdmin')).toBe(true)
  })

  it('rejects PropertyManager and Staff', () => {
    expect(canDeleteProperties('PropertyManager')).toBe(false)
    expect(canDeleteProperties('Staff')).toBe(false)
  })
})
