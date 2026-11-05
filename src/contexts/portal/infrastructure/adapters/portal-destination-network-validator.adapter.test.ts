import { createServer, type IncomingMessage, type Server } from 'node:http'
import { once } from 'node:events'
import { Resolver } from 'node:dns/promises'
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
    expect(request).toHaveBeenNthCalledWith(
      1,
      'https://example.com/start',
      {
        address: '8.8.8.8',
        family: 4,
      },
      expect.any(AbortSignal),
    )
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

  it('retries another vetted address after a fast connection failure', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce({ status: 200, location: null })
    const validator = createPortalDestinationNetworkValidator({
      clock: () => NOW,
      resolve: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '1.1.1.1', family: 4 },
      ],
      request,
    })
    await expect(validator.validate('https://example.com/')).resolves.toMatchObject({
      outcome: 'safe',
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1]?.[1]).toEqual({ address: '1.1.1.1', family: 4 })
  })

  it.each(['addresses', 'redirects', 'dns'] as const)(
    'shares one deadline across %s and waits for cancellation to drain',
    async (work) => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      let inFlight = 0
      let cancelled = 0
      let drained = 0
      const pause = async (duration: number, signal: AbortSignal) => {
        inFlight += 1
        try {
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              signal.removeEventListener('abort', abort)
              resolve()
            }
            const timer = setTimeout(done, duration)
            const abort = () => {
              clearTimeout(timer)
              cancelled += 1
              setTimeout(() => {
                drained += 1
                reject(signal.reason)
              }, 100)
            }
            signal.addEventListener('abort', abort, { once: true })
          })
        } finally {
          inFlight -= 1
        }
      }
      try {
        const resolve = vi.fn(async (_hostname: string, signal: AbortSignal) => {
          if (work === 'dns') await pause(60_000, signal)
          return ['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1'].map((address) => ({
            address,
            family: 4 as const,
          }))
        })
        const request = vi.fn(
          async (_uri: string, _address: unknown, signal: AbortSignal) => {
            await pause(2_000, signal)
            if (work === 'addresses') throw new Error('Connection failed')
            return { status: 302, location: '/next' }
          },
        )
        const validator = createPortalDestinationNetworkValidator({
          clock: () => new Date(),
          resolve,
          request,
          timeoutMs: 5_000,
        })
        let settled = false
        const running = validator.validate('https://example.com/').then((result) => {
          settled = true
          return result
        })
        await vi.advanceTimersByTimeAsync(5_000)
        expect(cancelled).toBe(1)
        expect(settled).toBe(false)
        expect(inFlight).toBe(1)
        await vi.advanceTimersByTimeAsync(100)
        await expect(running).resolves.toMatchObject({ outcome: 'unavailable' })
        expect(inFlight).toBe(0)
        expect(drained).toBe(1)
        expect(request).toHaveBeenCalledTimes(work === 'dns' ? 0 : 3)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('checks both DNS families before connecting and permits an absent family', async () => {
    const ipv4 = vi.spyOn(Resolver.prototype, 'resolve4').mockResolvedValue(['8.8.8.8'])
    const ipv6 = vi
      .spyOn(Resolver.prototype, 'resolve6')
      .mockRejectedValueOnce(
        Object.assign(new Error('No IPv6 answer'), { code: 'ENODATA' }),
      )
      .mockResolvedValueOnce(['::1'])
      .mockRejectedValueOnce(
        Object.assign(new Error('Resolver outage'), { code: 'ETIMEOUT' }),
      )
    try {
      const request = vi.fn().mockResolvedValue({ status: 200, location: null })
      const validator = createPortalDestinationNetworkValidator({
        clock: () => NOW,
        request,
      })
      await expect(validator.validate('https://example.com/')).resolves.toMatchObject({
        outcome: 'safe',
      })
      await expect(validator.validate('https://example.com/')).resolves.toMatchObject({
        outcome: 'unsafe',
        reason: 'dns_non_public',
      })
      await expect(validator.validate('https://example.com/')).resolves.toMatchObject({
        outcome: 'unavailable',
        reason: 'dns_unavailable',
      })
      expect(request).toHaveBeenCalledTimes(1)
      expect(ipv4).toHaveBeenCalledTimes(3)
      expect(ipv6).toHaveBeenCalledTimes(3)
    } finally {
      ipv4.mockRestore()
      ipv6.mockRestore()
    }
  })

  it('cancels its DNS resolver and drains both families before returning', async () => {
    vi.useFakeTimers()
    const rejectPending: Array<(error: Error) => void> = []
    const pending = () =>
      new Promise<string[]>((_resolve, reject) => rejectPending.push(reject))
    const ipv4 = vi.spyOn(Resolver.prototype, 'resolve4').mockImplementation(pending)
    const ipv6 = vi.spyOn(Resolver.prototype, 'resolve6').mockImplementation(pending)
    const cancel = vi.spyOn(Resolver.prototype, 'cancel').mockImplementation(() => {
      for (const reject of rejectPending)
        setTimeout(() => reject(new Error('DNS query cancelled')), 100)
    })
    try {
      const request = vi.fn()
      const validator = createPortalDestinationNetworkValidator({
        clock: () => NOW,
        request,
      })
      let settled = false
      const running = validator.validate('https://example.com/').then((result) => {
        settled = true
        return result
      })
      await vi.advanceTimersByTimeAsync(5_000)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(settled).toBe(false)
      expect(rejectPending).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(100)
      await expect(running).resolves.toMatchObject({
        outcome: 'unavailable',
        reason: 'dns_unavailable',
      })
      expect(request).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      ipv4.mockRestore()
      ipv6.mockRestore()
      cancel.mockRestore()
      vi.useRealTimers()
    }
  })

  it.each([
    ['ENOTFOUND', 'ENOTFOUND', 'dns_not_found'],
    ['ENODATA', 'ENODATA', 'dns_not_found'],
    ['ENODATA', 'ETIMEOUT', 'dns_unavailable'],
  ])(
    'classifies DNS failures from both families (%s, %s)',
    async (code4, code6, reason) => {
      const ipv4 = vi
        .spyOn(Resolver.prototype, 'resolve4')
        .mockRejectedValue({ code: code4 })
      const ipv6 = vi
        .spyOn(Resolver.prototype, 'resolve6')
        .mockRejectedValue({ code: code6 })
      try {
        const request = vi.fn()
        const validator = createPortalDestinationNetworkValidator({
          clock: () => NOW,
          request,
        })
        await expect(validator.validate('https://example.com/')).resolves.toMatchObject({
          outcome: 'unavailable',
          reason,
        })
        expect(request).not.toHaveBeenCalled()
      } finally {
        ipv4.mockRestore()
        ipv6.mockRestore()
      }
    },
  )
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
  let onFallbackGet: (req: IncomingMessage) => void
  const seen: { host?: string; method?: string }[] = []

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      seen.push({ host: req.headers.host, method: req.method })
      if (req.url === '/fallback') {
        if (req.method === 'HEAD') {
          res.writeHead(405)
          res.end()
        } else {
          onFallbackGet(req)
        }
        return
      }
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

  it('cancels and drains the GET fallback when the shared deadline expires', async () => {
    const controller = new AbortController()
    const closed = new Promise<void>((resolve) => {
      onFallbackGet = (req) => {
        req.socket.once('close', resolve)
        controller.abort(new Error('Validation deadline'))
      }
    })
    await expect(
      pinnedHead(
        `http://pinned.test:${port}/fallback`,
        { address: '127.0.0.1', family: 4 },
        2_000,
        controller.signal,
      ),
    ).rejects.toThrow('Validation deadline')
    await closed
    expect(seen.slice(-2).map(({ method }) => method)).toEqual(['HEAD', 'GET'])
  })
})
