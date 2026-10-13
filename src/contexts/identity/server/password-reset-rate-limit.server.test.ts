import { describe, expect, it, vi } from 'vitest'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { admitPasswordResetRequest } from './password-reset-rate-limit.server'

function limiterWith(allowed: boolean): RateLimiter & {
  check: ReturnType<typeof vi.fn>
} {
  const check = vi.fn(
    async () =>
      ({
        allowed,
        remaining: 0,
        resetAt: new Date('2026-10-13T12:00:00.000Z'),
        backendStatus: 'available',
      }) as const,
  )
  return { check }
}

const SECRET = 'identity-rate-limit-test-secret'

const resetRequest = (body: string, contentType = 'application/json') =>
  new Request('https://app.test/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })

const jsonRequest = (email: unknown) => resetRequest(JSON.stringify({ email }))

describe('password reset request abuse control', () => {
  it('counts the request against the address it names, three an hour', async () => {
    const rateLimiter = limiterWith(true)

    const admitted = await admitPasswordResetRequest({
      request: jsonRequest('dana@example.com'),
      rateLimiter,
      keyHmacSecret: SECRET,
    })

    expect(admitted).toBe(true)
    expect(rateLimiter.check).toHaveBeenCalledTimes(1)
    const [key, limit] = rateLimiter.check.mock.calls[0] ?? []
    expect(key).toMatch(/^identity:password-reset:email:[a-f0-9]{64}$/)
    expect(limit).toEqual({ maxRequests: 3, windowSeconds: 60 * 60 })
  })

  it('refuses once the address has used its requests', async () => {
    const admitted = await admitPasswordResetRequest({
      request: jsonRequest('dana@example.com'),
      rateLimiter: limiterWith(false),
      keyHmacSecret: SECRET,
    })

    expect(admitted).toBe(false)
  })

  it('never hands the address to the limiter store', async () => {
    const rateLimiter = limiterWith(true)

    await admitPasswordResetRequest({
      request: jsonRequest('dana@example.com'),
      rateLimiter,
      keyHmacSecret: SECRET,
    })

    expect(JSON.stringify(rateLimiter.check.mock.calls)).not.toContain('dana')
    expect(JSON.stringify(rateLimiter.check.mock.calls)).not.toContain('example.com')
  })

  // The provider looks an account up by the lowercased address, so the same
  // account must spend one budget however the address is typed.
  it('keeps one budget for an address whatever its case', async () => {
    const keyFor = async (email: string) => {
      const rateLimiter = limiterWith(true)
      await admitPasswordResetRequest({
        request: jsonRequest(email),
        rateLimiter,
        keyHmacSecret: SECRET,
      })
      return rateLimiter.check.mock.calls[0]?.[0] as string
    }

    expect(await keyFor('Dana@Example.COM')).toBe(await keyFor('dana@example.com'))
    expect(await keyFor('erin@example.com')).not.toBe(await keyFor('dana@example.com'))
  })

  it('leaves the body readable for the provider', async () => {
    const request = jsonRequest('dana@example.com')

    await admitPasswordResetRequest({
      request,
      rateLimiter: limiterWith(true),
      keyHmacSecret: SECRET,
    })

    expect(await request.json()).toEqual({ email: 'dana@example.com' })
  })

  // The provider refuses each of these itself (it accepts a JSON object whose
  // `email` is an address and nothing else), so no mail is sent and no budget
  // is spent.
  it.each([
    ['a body that is not JSON', resetRequest('email=dana%40example.com')],
    ['a JSON body that is not an object', resetRequest('null')],
    ['an address that is not a string', jsonRequest(['dana@example.com'])],
    ['an empty address', jsonRequest('   ')],
    ['no address', resetRequest('{}')],
  ])('admits %s without counting it', async (_name, request) => {
    const rateLimiter = limiterWith(false)

    const admitted = await admitPasswordResetRequest({
      request,
      rateLimiter,
      keyHmacSecret: SECRET,
    })

    expect(admitted).toBe(true)
    expect(rateLimiter.check).not.toHaveBeenCalled()
  })
})
