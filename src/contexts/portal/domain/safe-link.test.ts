import { describe, it, expect } from 'vitest'
import { validateExternalLink, getDefaultAllowlist } from './safe-link'

describe('SafeLink', () => {
  describe('validateExternalLink', () => {
    it('accepts allowlisted HTTPS Google Maps URL', () => {
      const result = validateExternalLink('https://www.google.com/maps/place/123')
      expect(result.valid).toBe(true)
    })

    it('accepts allowlisted HTTPS Google Search URL', () => {
      const result = validateExternalLink('https://www.google.com/search?q=test')
      expect(result.valid).toBe(true)
    })

    it('rejects HTTP (not HTTPS)', () => {
      const result = validateExternalLink('http://www.google.com/maps')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('not_https')
    })

    it('rejects non-allowlisted host', () => {
      const result = validateExternalLink('https://evil.com/path')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('not_in_allowlist')
    })

    it('rejects credentials in URL', () => {
      const result = validateExternalLink('https://user:pass@www.google.com/maps')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('has_credentials')
    })

    it('rejects control characters', () => {
      const result = validateExternalLink('https://www.google.com/maps\n')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('has_control_chars')
    })

    it('rejects private IP addresses', () => {
      const result = validateExternalLink('https://127.0.0.1/admin')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('is_private_ip')
    })

    it('rejects localhost', () => {
      const result = validateExternalLink('https://localhost/admin')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('is_private_ip')
    })

    it('rejects 192.168.x.x', () => {
      const result = validateExternalLink('https://192.168.1.1/admin')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('is_private_ip')
    })

    it('rejects open redirect pattern (double scheme)', () => {
      const result = validateExternalLink(
        'https://www.google.com/redirect?url=https://evil.com',
      )
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('has_open_redirect_pattern')
    })

    it('rejects invalid URL', () => {
      const result = validateExternalLink('not-a-url')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.error.code).toBe('invalid_scheme')
    })

    it('respects pathPrefix in allowlist', () => {
      const allowlist = [{ host: 'example.com', pathPrefix: '/safe' }]
      const valid = validateExternalLink('https://example.com/safe/page', allowlist)
      expect(valid.valid).toBe(true)

      const invalid = validateExternalLink('https://example.com/unsafe/page', allowlist)
      expect(invalid.valid).toBe(false)
    })
  })

  describe('getDefaultAllowlist', () => {
    it('includes Google domains', () => {
      const allowlist = getDefaultAllowlist()
      expect(allowlist.some((e) => e.host === 'www.google.com')).toBe(true)
      expect(allowlist.some((e) => e.host === 'maps.google.com')).toBe(true)
    })
  })
})
