import { describe, it, expect } from 'vitest'
import { isPublicHttpsDestination } from './safe-link'

describe('isPublicHttpsDestination', () => {
  it('accepts public HTTPS destinations', () => {
    expect(isPublicHttpsDestination('https://www.google.com/maps/place/123')).toBe(true)
    expect(isPublicHttpsDestination('https://example.com/path?q=1#hash')).toBe(true)
  })

  it('rejects HTTP', () => {
    expect(isPublicHttpsDestination('http://www.google.com/maps')).toBe(false)
  })

  it('rejects credentials in the URL', () => {
    // @proof PUBLIC_REDIRECT_AND_ABUSE#1
    expect(isPublicHttpsDestination('https://user:pass@www.google.com/maps')).toBe(false)
  })

  it('rejects control characters', () => {
    expect(isPublicHttpsDestination('https://www.google.com/maps\n')).toBe(false)
  })

  it('rejects an invalid URL', () => {
    expect(isPublicHttpsDestination('not a url')).toBe(false)
  })

  it('rejects private, loopback and local-only destinations', () => {
    // @proof PUBLIC_REDIRECT_AND_ABUSE#2
    for (const url of [
      'https://127.0.0.1/admin',
      'https://localhost/admin',
      'https://192.168.1.1/admin',
      'https://[::1]/maps',
      'https://[ff02::1]/maps',
      'https://service.internal/maps',
      'https://portal.localhost/maps',
      'https://router.home.arpa/maps',
      'https://printer/maps',
    ]) {
      expect(isPublicHttpsDestination(url), url).toBe(false)
    }
  })
})
