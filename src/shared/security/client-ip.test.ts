import { describe, it, expect, afterEach } from 'vitest'
import {
  getClientIpFromForwardedFor,
  getClientIpFromRailwayHeaders,
  deriveClientIp,
  clientIpFromHeaders,
} from './client-ip'
import { resetEnv } from '#/shared/config/env'

describe('client-ip (B0.7)', () => {
  describe('getClientIpFromForwardedFor', () => {
    it('extracts client IP with 1 trusted proxy', () => {
      // The direct proxy is represented by the socket, not appended to XFF.
      const result = getClientIpFromForwardedFor('203.0.113.5', 1)
      expect(result).toBe('203.0.113.5')
    })

    it('extracts client IP with 2 trusted proxies', () => {
      const result = getClientIpFromForwardedFor('203.0.113.5, 10.0.0.1', 2)
      expect(result).toBe('203.0.113.5')
    })

    it('rejects a chain shorter than the configured proxy count', () => {
      const result = getClientIpFromForwardedFor('203.0.113.5', 3)
      expect(result).toBeUndefined()
    })

    it('returns undefined for empty header', () => {
      expect(getClientIpFromForwardedFor(undefined, 1)).toBeUndefined()
      expect(getClientIpFromForwardedFor('', 1)).toBeUndefined()
    })

    it('trims whitespace from hops', () => {
      const result = getClientIpFromForwardedFor('  203.0.113.5  ', 1)
      expect(result).toBe('203.0.113.5')
    })

    it('handles IPv6 addresses', () => {
      const result = getClientIpFromForwardedFor('::1', 1)
      expect(result).toBe('::1')
    })

    it('rejects malformed hops instead of filtering around them', () => {
      expect(getClientIpFromForwardedFor('203.0.113.5, garbage', 1)).toBeUndefined()
      expect(getClientIpFromForwardedFor('203.0.113.5,,10.0.0.1', 1)).toBeUndefined()
    })

    it('rejects chains above the configured maximum', () => {
      expect(
        getClientIpFromForwardedFor('198.51.100.1, 198.51.100.2, 198.51.100.3', 1, 2),
      ).toBeUndefined()
    })
  })

  describe('getClientIpFromRailwayHeaders', () => {
    it('accepts Railway X-Real-IP only with the edge marker contract', () => {
      const headers = new Headers({
        'x-real-ip': '203.0.113.5',
        'x-railway-edge': 'ams1',
        'x-railway-request-id': 'request-1',
      })
      expect(getClientIpFromRailwayHeaders(headers)).toBe('203.0.113.5')
    })

    it('rejects a missing Railway marker or malformed X-Real-IP', () => {
      expect(
        getClientIpFromRailwayHeaders(new Headers({ 'x-real-ip': '203.0.113.5' })),
      ).toBeUndefined()
      expect(
        getClientIpFromRailwayHeaders(
          new Headers({
            'x-real-ip': '203.0.113.5, 6.6.6.6',
            'x-railway-edge': 'ams1',
            'x-railway-request-id': 'request-1',
          }),
        ),
      ).toBeUndefined()
    })
  })

  describe('deriveClientIp', () => {
    it('uses forwarded header when behind trusted proxies', () => {
      const result = deriveClientIp('10.0.0.1', '203.0.113.5', 1)
      expect(result).toBe('203.0.113.5')
    })

    it('falls back to the socket when the forwarded chain is too short', () => {
      const result = deriveClientIp('10.0.0.1', '203.0.113.5', 2)
      expect(result).toBe('10.0.0.1')
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

  describe('clientIpFromHeaders (wired call-site seam, BQC-7.6)', () => {
    afterEach(() => {
      delete process.env.TRUSTED_PROXY_COUNT
      delete process.env.TRUSTED_PROXY_MAX_HOPS
      delete process.env.TRUSTED_PROXY_MODE
      resetEnv()
    })

    it('spoofed leftmost XFF yields the trusted hop, not the spoofed value', () => {
      // TRUSTED_PROXY_COUNT defaults to 1: the rightmost hop is the source IP
      // appended by the one trusted proxy; caller-prepended values stay left.
      process.env.TRUSTED_PROXY_MODE = 'xff'
      delete process.env.TRUSTED_PROXY_COUNT
      resetEnv()
      const headers = new Headers({
        'x-forwarded-for': '6.6.6.6, 203.0.113.5',
      })
      expect(clientIpFromHeaders(headers)).toBe('203.0.113.5')
    })

    it('honors a multi-proxy chain when TRUSTED_PROXY_COUNT=2', () => {
      process.env.TRUSTED_PROXY_MODE = 'xff'
      process.env.TRUSTED_PROXY_COUNT = '2'
      resetEnv()
      const headers = new Headers({
        'x-forwarded-for': '6.6.6.6, 203.0.113.5, 10.0.0.1',
      })
      expect(clientIpFromHeaders(headers)).toBe('203.0.113.5')
    })

    it('never trusts XFF when TRUSTED_PROXY_COUNT=0', () => {
      process.env.TRUSTED_PROXY_MODE = 'xff'
      process.env.TRUSTED_PROXY_COUNT = '0'
      resetEnv()
      const headers = new Headers({ 'x-forwarded-for': '203.0.113.5' })
      expect(clientIpFromHeaders(headers)).toBe('unknown')
    })

    it('returns unknown when XFF is absent', () => {
      process.env.TRUSTED_PROXY_MODE = 'xff'
      delete process.env.TRUSTED_PROXY_COUNT
      resetEnv()
      expect(clientIpFromHeaders(new Headers())).toBe('unknown')
    })

    it('uses Railway X-Real-IP and ignores a spoofed XFF in railway-edge mode', () => {
      process.env.TRUSTED_PROXY_MODE = 'railway-edge'
      resetEnv()
      const headers = new Headers({
        'x-forwarded-for': '6.6.6.6',
        'x-real-ip': '203.0.113.5',
        'x-railway-edge': 'ams1',
        'x-railway-request-id': 'request-1',
      })
      expect(clientIpFromHeaders(headers)).toBe('203.0.113.5')
    })

    it('trusts no forwarding header in direct mode', () => {
      process.env.TRUSTED_PROXY_MODE = 'direct'
      resetEnv()
      const headers = new Headers({
        'x-forwarded-for': '203.0.113.5',
        'x-real-ip': '198.51.100.1',
        'x-railway-edge': 'ams1',
        'x-railway-request-id': 'request-1',
      })
      expect(clientIpFromHeaders(headers)).toBe('unknown')
    })
  })
})
