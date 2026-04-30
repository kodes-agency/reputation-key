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
    expect(validateSlug('').isErr()).toBe(true)
  })

  it('rejects single char', () => {
    expect(validateSlug('a').isErr()).toBe(true)
  })

  it('rejects uppercase', () => {
    expect(validateSlug('My-Portal').isErr()).toBe(true)
  })

  it('rejects leading hyphen', () => {
    expect(validateSlug('-hello').isErr()).toBe(true)
  })
})

// ── validatePortalName ─────────────────────────────────────────────

describe('validatePortalName', () => {
  it('accepts valid names', () => {
    expect(validatePortalName('Grand Portal').isOk()).toBe(true)
  })

  it('rejects empty', () => {
    expect(validatePortalName('').isErr()).toBe(true)
  })

  it('rejects whitespace-only', () => {
    expect(validatePortalName('   ').isErr()).toBe(true)
  })

  it('rejects over 100 chars', () => {
    expect(validatePortalName('x'.repeat(101)).isErr()).toBe(true)
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
    expect(validateDescription('x'.repeat(501)).isErr()).toBe(true)
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
    expect(validatePortalTheme({ backgroundColor: '#FFFFFF' }).isErr()).toBe(true)
  })

  it('rejects invalid hex', () => {
    expect(validatePortalTheme({ primaryColor: 'red' }).isErr()).toBe(true)
  })

  it('rejects short hex', () => {
    expect(validatePortalTheme({ primaryColor: '#FFF' }).isErr()).toBe(true)
  })
})

// ── validateSmartRoutingThreshold ──────────────────────────────────

describe('validateSmartRoutingThreshold', () => {
  it('accepts 1 through 4', () => {
    expect(validateSmartRoutingThreshold(1).isOk()).toBe(true)
    expect(validateSmartRoutingThreshold(2).isOk()).toBe(true)
    expect(validateSmartRoutingThreshold(3).isOk()).toBe(true)
    expect(validateSmartRoutingThreshold(4).isOk()).toBe(true)
  })

  it('rejects 0', () => {
    expect(validateSmartRoutingThreshold(0).isErr()).toBe(true)
  })

  it('rejects 5', () => {
    expect(validateSmartRoutingThreshold(5).isErr()).toBe(true)
  })

  it('rejects non-integer', () => {
    expect(validateSmartRoutingThreshold(2.5).isErr()).toBe(true)
  })
})

// ── validateUrl ────────────────────────────────────────────────────

describe('validateUrl', () => {
  it('accepts valid URLs', () => {
    expect(validateUrl('https://example.com').isOk()).toBe(true)
    expect(validateUrl('http://localhost:3000/path').isOk()).toBe(true)
  })

  it('rejects non-URLs', () => {
    expect(validateUrl('not a url').isErr()).toBe(true)
  })

  it('rejects empty', () => {
    expect(validateUrl('').isErr()).toBe(true)
  })
})

// ── validateLinkLabel ──────────────────────────────────────────────

describe('validateLinkLabel', () => {
  it('accepts valid labels', () => {
    expect(validateLinkLabel('Google Review').isOk()).toBe(true)
  })

  it('rejects empty', () => {
    expect(validateLinkLabel('').isErr()).toBe(true)
  })

  it('rejects over 100 chars', () => {
    expect(validateLinkLabel('x'.repeat(101)).isErr()).toBe(true)
  })
})

// ── validateCategoryTitle ──────────────────────────────────────────

describe('validateCategoryTitle', () => {
  it('accepts valid titles', () => {
    expect(validateCategoryTitle('Reviews').isOk()).toBe(true)
  })

  it('rejects empty', () => {
    expect(validateCategoryTitle('').isErr()).toBe(true)
  })

  it('rejects over 100 chars', () => {
    expect(validateCategoryTitle('x'.repeat(101)).isErr()).toBe(true)
  })
})
