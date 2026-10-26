// Portal context — domain rules tests
// Per architecture: "Pure unit, no setup, no mocks. Run in milliseconds."

import { describe, it, expect } from 'vitest'
import {
  normalizeSlug,
  validateSlug,
  validatePortalName,
  validateDescription,
  validatePortalTheme,
  validatePrivateFeedbackThreshold,
  validateUrl,
  isValidExternalUrl,
  isValidLinkDestination,
  linkAddressRefusal,
  validateLinkLabel,
  validateLinkIconKey,
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

  it('rejects invalid backgroundColor', () => {
    const result = validatePortalTheme({
      primaryColor: '#FF5500',
      backgroundColor: 'blue',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_theme')
    }
  })

  it('rejects invalid textColor', () => {
    const result = validatePortalTheme({ primaryColor: '#FF5500', textColor: '#12345' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_theme')
    }
  })
})

// ── validatePrivateFeedbackThreshold ───────────────────────────────

describe('validatePrivateFeedbackThreshold', () => {
  it('accepts 1 through 5', () => {
    expect(validatePrivateFeedbackThreshold(1).isOk()).toBe(true)
    expect(validatePrivateFeedbackThreshold(2).isOk()).toBe(true)
    expect(validatePrivateFeedbackThreshold(3).isOk()).toBe(true)
    expect(validatePrivateFeedbackThreshold(4).isOk()).toBe(true)
    expect(validatePrivateFeedbackThreshold(5).isOk()).toBe(true)
  })

  it('rejects 0', () => {
    const result = validatePrivateFeedbackThreshold(0)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_threshold')
    }
  })

  it('rejects 6', () => {
    const result = validatePrivateFeedbackThreshold(6)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_threshold')
    }
  })

  it('rejects non-integer', () => {
    const result = validatePrivateFeedbackThreshold(2.5)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_threshold')
    }
  })
})

// ── validateUrl ────────────────────────────────────────────────────

describe('validateUrl', () => {
  it('accepts https URLs', () => {
    expect(validateUrl('https://example.com').isOk()).toBe(true)
    expect(validateUrl('https://example.com/path?q=1#hash').isOk()).toBe(true)
  })

  it('accepts a phone number or an email address in its stored form', () => {
    expect(validateUrl('tel:+15551234567').isOk()).toBe(true)
    expect(validateUrl('mailto:admin@example.com').isOk()).toBe(true)
  })

  it('rejects non-https schemes', () => {
    // validateUrl is the constructor-time gate for stored link destinations, so it
    // must reject everything isValidLinkDestination rejects — including http, the
    // script-bearing schemes `new URL()` parses happily, and a `tel:` or `mailto:`
    // address that is not in its stored form.
    for (const url of [
      'http://localhost:3000/path',
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'mailto:admin@example.com?bcc=spy@evil.com',
      'tel:+1 555 123 4567',
      'sms:+15551234567',
      '//evil.com',
    ]) {
      const result = validateUrl(url)
      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.code).toBe('invalid_url')
      }
    }
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

// ── validateLinkIconKey ────────────────────────────────────────────

describe('validateLinkIconKey', () => {
  it('accepts a member of the icon set and keeps it', () => {
    const result = validateLinkIconKey('waves')
    expect(result.isOk() && result.value).toBe('waves')
  })

  it('reads an absent or null key as no icon', () => {
    const absent = validateLinkIconKey(undefined)
    const cleared = validateLinkIconKey(null)
    expect(absent.isOk() && absent.value).toBeNull()
    expect(cleared.isOk() && cleared.value).toBeNull()
  })

  it('refuses anything outside the set with invalid_icon', () => {
    for (const key of ['google', '', 'Waves', 'waves ']) {
      const result = validateLinkIconKey(key)
      expect(result.isErr() && result.error.code).toBe('invalid_icon')
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

  it('rejects credentials and private or local destinations', () => {
    for (const url of [
      'https://user:pass@example.com/path',
      'https://127.0.0.1/admin',
      'https://0x7f000001/admin',
      'https://[::1]/admin',
      'https://service.internal/admin',
      'https://portal.localhost/admin',
    ]) {
      expect(isValidExternalUrl(url), url).toBe(false)
    }
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

// ── isValidLinkDestination and linkAddressRefusal ──────────────────

describe('isValidLinkDestination', () => {
  it('accepts a public website and a stored phone number or email address', () => {
    for (const url of [
      'https://example.com/spa',
      'tel:+15551234567',
      'tel:5551234567',
      'mailto:front@hotel.com',
    ]) {
      expect(isValidLinkDestination(url), url).toBe(true)
    }
  })

  it('refuses every other scheme and every unstored contact spelling', () => {
    for (const url of [
      'http://example.com',
      'https://127.0.0.1/admin',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'TEL:+15551234567',
      'tel:+1-555-123-4567',
      'tel:+15551234567;ext=2',
      'mailto:front@hotel.com?subject=hi',
      'mailto:front@hotel.com,spy@evil.com',
      'mailto:front@HOTEL.com',
      'front@hotel.com',
      '+15551234567',
    ]) {
      expect(isValidLinkDestination(url), url).toBe(false)
    }
  })
})

describe('linkAddressRefusal', () => {
  it('takes a website, a phone number or an email address as typed', () => {
    for (const value of [
      'https://example.com/spa',
      ' https://example.com ',
      '+1 (555) 123-4567',
      'tel:+15551234567',
      'front@hotel.com',
      'mailto:front@hotel.com',
    ]) {
      expect(linkAddressRefusal(value), value).toBeNull()
    }
  })

  it('names what was wrong with a phone number, an email address or anything else', () => {
    expect(linkAddressRefusal('555 12')).toMatch(
      /^Enter a phone number of 7 to 15 digits/u,
    )
    expect(linkAddressRefusal('front@hotel.com?bcc=x@y.com')).toMatch(
      /^Enter one email address/u,
    )
    for (const value of [
      'http://example.com',
      'javascript:alert(1)',
      'www.hotel.com',
      'instagram.com/@hotel',
    ]) {
      expect(linkAddressRefusal(value), value).toBe(
        'Enter a website starting with https://, a phone number or an email address.',
      )
    }
  })
})
