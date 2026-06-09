// Portal context — domain rules tests
// Per architecture: "Pure unit, no setup, no mocks. Run in milliseconds."

import { describe, it, expect } from 'vitest'
import {
  normalizeSlug,
  validateSlug,
  validatePortalName,
  validateDescription,
  validatePortalTheme,
  validateSmartRoutingThreshold,
  validateUrl,
  isValidExternalUrl,
  validateLinkLabel,
  validateCategoryTitle,
} from './rules'

// ── normalizeSlug ──────────────────────────────────────────────────

describe('normalizeSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(normalizeSlug('My Portal')).toBe('my-portal')
  })

  it('strips special characters', () => {
    expect(normalizeSlug('Hello & World!')).toBe('hello-world')
  })

  it('replaces repeated hyphens with single', () => {
    expect(normalizeSlug('foo---bar')).toBe('foo-bar')
  })

  it('trims leading and trailing hyphens', () => {
    expect(normalizeSlug('--hello--')).toBe('hello')
  })

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100)
    expect(normalizeSlug(long).length).toBeLessThanOrEqual(64)
  })
})

// ── validateSlug ───────────────────────────────────────────────────

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    expect(validateSlug('my-portal').isOk()).toBe(true)
    expect(validateSlug('abc123').isOk()).toBe(true)
    expect(validateSlug('grand-hotel-nyc').isOk()).toBe(true)
  })

  it('rejects empty', () => {
    const result = validateSlug('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_slug')
    }
  })

  it('rejects single char', () => {
    const result = validateSlug('a')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_slug')
    }
  })

  it('rejects uppercase', () => {
    const result = validateSlug('My-Portal')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_slug')
    }
  })

  it('rejects leading hyphen', () => {
    const result = validateSlug('-hello')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_slug')
    }
  })
})

// ── validatePortalName ─────────────────────────────────────────────

describe('validatePortalName', () => {
  it('accepts valid names', () => {
    expect(validatePortalName('Grand Portal').isOk()).toBe(true)
  })

  it('rejects empty', () => {
    const result = validatePortalName('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_name')
    }
  })

  it('rejects whitespace-only', () => {
    const result = validatePortalName('   ')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_name')
    }
  })

  it('rejects over 100 chars', () => {
    const result = validatePortalName('x'.repeat(101))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_name')
    }
  })

  it('trims whitespace', () => {
    const result = validatePortalName('  hello  ')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe('hello')
  })
})

// ── validateDescription ────────────────────────────────────────────

describe('validateDescription', () => {
  it('accepts null', () => {
    const r = validateDescription(null)
    expect(r.isOk()).toBe(true)
    if (r.isOk()) expect(r.value).toBeNull()
  })

  it('accepts undefined', () => {
    const r = validateDescription(undefined)
    expect(r.isOk()).toBe(true)
    if (r.isOk()) expect(r.value).toBeNull()
  })

  it('accepts valid descriptions', () => {
    expect(validateDescription('A nice portal').isOk()).toBe(true)
  })

  it('rejects over 500 chars', () => {
    const result = validateDescription('x'.repeat(501))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_description')
    }
  })
})

// ── validatePortalTheme ────────────────────────────────────────────

describe('validatePortalTheme', () => {
  it('accepts valid theme with primary only', () => {
    const r = validatePortalTheme({ primaryColor: '#FF5500' })
    expect(r.isOk()).toBe(true)
  })

  it('accepts full theme', () => {
    const r = validatePortalTheme({
      primaryColor: '#6366F1',
      backgroundColor: '#FFFFFF',
      textColor: '#000000',
    })
    expect(r.isOk()).toBe(true)
  })

  it('rejects missing primaryColor', () => {
    const result = validatePortalTheme({ backgroundColor: '#FFFFFF' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_theme')
    }
  })

  it('rejects invalid hex', () => {
    const result = validatePortalTheme({ primaryColor: 'red' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_theme')
    }
  })

  it('rejects short hex', () => {
    const result = validatePortalTheme({ primaryColor: '#FFF' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_theme')
    }
  })
})

// ── validateSmartRoutingThreshold ──────────────────────────────────

describe('validateSmartRoutingThreshold', () => {
  it('accepts 1 through 5', () => {
    expect(validateSmartRoutingThreshold(1).isOk()).toBe(true)
    expect(validateSmartRoutingThreshold(2).isOk()).toBe(true)
    expect(validateSmartRoutingThreshold(3).isOk()).toBe(true)
    expect(validateSmartRoutingThreshold(4).isOk()).toBe(true)
    expect(validateSmartRoutingThreshold(5).isOk()).toBe(true)
  })

  it('rejects 0', () => {
    const result = validateSmartRoutingThreshold(0)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_threshold')
    }
  })

  it('rejects 6', () => {
    const result = validateSmartRoutingThreshold(6)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_threshold')
    }
  })

  it('rejects non-integer', () => {
    const result = validateSmartRoutingThreshold(2.5)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_threshold')
    }
  })
})

// ── validateUrl ────────────────────────────────────────────────────

describe('validateUrl', () => {
  it('accepts valid URLs', () => {
    expect(validateUrl('https://example.com').isOk()).toBe(true)
    expect(validateUrl('http://localhost:3000/path').isOk()).toBe(true)
  })

  it('rejects non-URLs', () => {
    const result = validateUrl('not a url')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_url')
    }
  })

  it('rejects empty', () => {
    const result = validateUrl('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_url')
    }
  })
})

// ── validateLinkLabel ──────────────────────────────────────────────

describe('validateLinkLabel', () => {
  it('accepts valid labels', () => {
    expect(validateLinkLabel('Google Review').isOk()).toBe(true)
  })

  it('rejects empty', () => {
    const result = validateLinkLabel('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_label')
    }
  })

  it('rejects over 100 chars', () => {
    const result = validateLinkLabel('x'.repeat(101))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_label')
    }
  })
})

// ── validateCategoryTitle ──────────────────────────────────────────

describe('validateCategoryTitle', () => {
  it('accepts valid titles', () => {
    expect(validateCategoryTitle('Reviews').isOk()).toBe(true)
  })

  it('rejects empty', () => {
    const result = validateCategoryTitle('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_title')
    }
  })

  it('rejects over 100 chars', () => {
    const result = validateCategoryTitle('x'.repeat(101))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_title')
    }
  })
})

// ── isValidExternalUrl ────────────────────────────────────────────

describe('isValidExternalUrl', () => {
  it('accepts valid https URLs', () => {
    expect(isValidExternalUrl('https://example.com')).toBe(true)
    expect(isValidExternalUrl('https://example.com/path?q=1#hash')).toBe(true)
  })

  it('rejects http URLs', () => {
    expect(isValidExternalUrl('http://example.com')).toBe(false)
  })

  it('rejects javascript: scheme', () => {
    expect(isValidExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects data: scheme', () => {
    expect(isValidExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects protocol-relative URLs', () => {
    expect(isValidExternalUrl('//evil.com')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isValidExternalUrl('')).toBe(false)
    expect(isValidExternalUrl('not-a-url')).toBe(false)
  })

  it('rejects mailto: scheme', () => {
    expect(isValidExternalUrl('mailto:admin@example.com')).toBe(false)
  })
})
