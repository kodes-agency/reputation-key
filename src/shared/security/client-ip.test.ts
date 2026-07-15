import { describe, it, expect } from 'vitest'
import { getClientIpFromForwardedFor, deriveClientIp } from './client-ip'

describe('client-ip (B0.7)', () => {
  describe('getClientIpFromForwardedFor', () => {
    it('extracts client IP with 1 trusted proxy', () => {
      const result = getClientIpFromForwardedFor('203.0.113.5, 10.0.0.1', 1)
      expect(result).toBe('203.0.113.5')
    })

    it('extracts client IP with 2 trusted proxies', () => {
      const result = getClientIpFromForwardedFor('203.0.113.5, 10.0.0.1, 10.0.0.2', 2)
      expect(result).toBe('203.0.113.5')
    })

    it('takes leftmost when fewer hops than proxies', () => {
      const result = getClientIpFromForwardedFor('203.0.113.5', 3)
      expect(result).toBe('203.0.113.5')
    })

    it('returns undefined for empty header', () => {
      expect(getClientIpFromForwardedFor(undefined, 1)).toBeUndefined()
      expect(getClientIpFromForwardedFor('', 1)).toBeUndefined()
    })

    it('trims whitespace from hops', () => {
      const result = getClientIpFromForwardedFor('  203.0.113.5  ,  10.0.0.1  ', 1)
      expect(result).toBe('203.0.113.5')
    })

    it('handles IPv6 addresses', () => {
      const result = getClientIpFromForwardedFor('::1, ::ffff:10.0.0.1', 1)
      expect(result).toBe('::1')
    })
  })

  describe('deriveClientIp', () => {
    it('uses forwarded header when behind trusted proxies', () => {
      const result = deriveClientIp('10.0.0.1', '203.0.113.5, 10.0.0.1', 1)
      expect(result).toBe('203.0.113.5')
    })

    it('falls back to remote address when no proxies', () => {
      const result = deriveClientIp('192.168.1.1', undefined, 0)
      expect(result).toBe('192.168.1.1')
    })

    it('falls back to remote address when header is missing', () => {
      const result = deriveClientIp('192.168.1.1', undefined, 1)
      expect(result).toBe('192.168.1.1')
    })

    it('returns unknown when no information available', () => {
      const result = deriveClientIp(undefined, undefined, 0)
      expect(result).toBe('unknown')
    })
  })
})
