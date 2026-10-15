import { createServer, type IncomingMessage, type Server } from 'node:http'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createPortalDestinationNetworkValidator,
  isPublicPortalDestinationAddress,
  pinnedHead,
  pinnedLookup,
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

  it.each([
    ['https://example.com/start', 'https://www.example.com/start'],
    ['https://www.example.com/start', 'https://example.com/start'],
  ])('follows the www redirect of the same site (%s)', async (from, to) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 301, location: to })
      .mockResolvedValueOnce({ status: 200, location: null })
    const validator = createPortalDestinationNetworkValidator({
      clock: () => NOW,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request,
    })
    await expect(validator.validate(from)).resolves.toEqual({
      outcome: 'safe',
      validatedAt: NOW,
      finalUri: to,
      redirectCount: 1,
    })
  })

  it('reports a hostname that does not exist separately from a resolver outage', async () => {
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND nope.example'), {
      code: 'ENOTFOUND',
    })
    const validator = createPortalDestinationNetworkValidator({
      clock: () => NOW,
      resolve: async () => {
        throw notFound
      },
      request: vi.fn(),
    })
    await expect(validator.validate('https://nope.example/')).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'dns_not_found',
      observedAt: NOW,
    })
  })

  it('keeps a resolver outage transient', async () => {
    const outage = Object.assign(new Error('queryA EAI_AGAIN'), { code: 'EAI_AGAIN' })
    const validator = createPortalDestinationNetworkValidator({
      clock: () => NOW,
      resolve: async () => {
        throw outage
      },
      request: vi.fn(),
    })
    await expect(validator.validate('https://example.com/')).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'dns_unavailable',
      observedAt: NOW,
    })
  })
})

/**
 * The connector itself, not a stub. Answering Happy Eyeballs (`all: true`) with
 * a bare address string failed every connection with `ERR_INVALID_IP_ADDRESS`,
 * which the validator reported as "temporarily unavailable" — invisible to
 * every test above, because they inject their own `request`.
 */
describe('Pinned destination request', () => {
  let server: Server
  let port = 0
  const seen: { host?: string; method?: string }[] = []

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      seen.push({ host: req.headers.host, method: req.method })
      if (req.url === '/moved') {
        res.writeHead(301, { location: 'https://pinned.test/final' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    port = typeof address === 'object' && address ? address.port : 0
  })

  afterAll(async () => {
    server.close()
    await once(server, 'close')
  })

  it('answers the Happy Eyeballs list form with the vetted address', () => {
    const callback = vi.fn()
    pinnedLookup({ address: '8.8.8.8', family: 4 })(
      'ignored.example',
      { all: true },
      callback,
    )
    expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }])
  })

  it('answers the single-address form with the vetted address', () => {
    const callback = vi.fn()
    pinnedLookup({ address: '8.8.8.8', family: 4 })('ignored.example', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4)
  })

  it('connects through the pinned address and keeps the requested host', async () => {
    await expect(
      pinnedHead(
        `http://pinned.test:${port}/`,
        { address: '127.0.0.1', family: 4 },
        2_000,
      ),
    ).resolves.toEqual({ status: 200, location: null })
    expect(seen.at(-1)).toEqual({ host: `pinned.test:${port}`, method: 'HEAD' })
  })

  it('reports a redirect without following it', async () => {
    await expect(
      pinnedHead(
        `http://pinned.test:${port}/moved`,
        { address: '127.0.0.1', family: 4 },
        2_000,
      ),
    ).resolves.toEqual({ status: 301, location: 'https://pinned.test/final' })
  })
})
