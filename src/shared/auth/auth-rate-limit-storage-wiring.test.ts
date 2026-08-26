import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisState = vi.hoisted(() => ({ client: undefined as Redis | undefined }))

vi.mock('#/shared/cache/redis', () => ({
  getRedis: () => redisState.client,
}))

import { createAuth } from './auth'

describe('Better Auth rate-limit storage wiring', () => {
  beforeEach(() => {
    redisState.client = undefined
  })

  it('keeps the in-process backend only for non-production execution without Redis', () => {
    const auth = createAuth()

    expect(auth.options.rateLimit?.enabled).toBe(true)
    expect(auth.options.rateLimit?.customStorage).toBeUndefined()
    expect(auth.options).not.toHaveProperty('secondaryStorage')
  })

  it('shares only rate-limit state when cache Redis is configured', () => {
    redisState.client = {} as Redis
    const auth = createAuth()

    expect(auth.options.rateLimit?.customStorage).toMatchObject({
      get: expect.any(Function),
      set: expect.any(Function),
      consume: expect.any(Function),
    })
    expect(auth.options.rateLimit).not.toHaveProperty('storage')
    expect(auth.options).not.toHaveProperty('secondaryStorage')
  })
})
