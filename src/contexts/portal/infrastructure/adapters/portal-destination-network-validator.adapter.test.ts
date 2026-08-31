import { describe, expect, it, vi } from 'vitest'
import {
  createPortalDestinationNetworkValidator,
  isPublicPortalDestinationAddress,
} from './portal-destination-network-validator.adapter'

const NOW = new Date('2026-08-27T09:00:00.000Z')

describe('Portal destination network validation', () => {
  it.each([
    '127.0.0.1',
    '10.20.30.40',
    '100.64.0.1',
    '169.254.169.254',
    '192.168.1.2',
    '198.51.100.3',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:8.8.8.8',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicPortalDestinationAddress(address)).toBe(false)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'accepts global address %s',
    (address) => {
      expect(isPublicPortalDestinationAddress(address)).toBe(true)
    },
  )

  it('rejects the whole hostname when any DNS answer is non-public', async () => {
    const request = vi.fn()
    const validator = createPortalDestinationNetworkValidator({
      clock: () => NOW,
      resolve: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      request,
    })
    await expect(validator.validate('https://example.com/path')).resolves.toEqual({
      outcome: 'unsafe',
      reason: 'dns_non_public',
      observedAt: NOW,
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('pins a vetted address and accepts a same-host redirect', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 302, location: '/final' })
      .mockResolvedValueOnce({ status: 200, location: null })
    const validator = createPortalDestinationNetworkValidator({
      clock: () => NOW,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request,
    })
    await expect(validator.validate('https://example.com/start')).resolves.toEqual({
      outcome: 'safe',
      validatedAt: NOW,
      finalUri: 'https://example.com/final',
      redirectCount: 1,
    })
    expect(request).toHaveBeenNthCalledWith(1, 'https://example.com/start', {
      address: '8.8.8.8',
      family: 4,
    })
  })

  it('rejects a redirect to a different public host before connecting to it', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 302,
      location: 'https://other.example/path',
    })
    const validator = createPortalDestinationNetworkValidator({
      clock: () => NOW,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request,
    })
    await expect(validator.validate('https://example.com/start')).resolves.toEqual({
      outcome: 'unsafe',
      reason: 'redirect_host_changed',
      observedAt: NOW,
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
