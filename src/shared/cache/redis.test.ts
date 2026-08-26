// BQC-7.1 — shared Redis client lifecycle tests.
//
// Pins the process-wide singleton contract the web graceful shutdown relies
// on (the production build bundles this module twice — nitro app chunk + lazy
// SSR chunk — so the Symbol.for store is what keeps one client per process):
//   1. REDIS_URL absent → no client, no connection attempt;
//   2. creation options (maxRetriesPerRequest=3, lazyConnect) and the
//      second-call dedup returning the SAME instance;
//   3. the error handler is non-fatal in development and error-level
//      otherwise;
//   4. closeRedis quits a live client, skips an already-ended one, no-ops
//      when nothing was created, and resets the store so getRedis recreates.
//
// ioredis is mocked — the unit project is hermetic (no Redis server).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetEnv } from '#/shared/config/env'

const loggerSpies = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => loggerSpies,
}))

vi.mock('ioredis', () => {
  class FakeRedis {
    static instances: FakeRedis[] = []
    status = 'ready'
    readonly handlers = new Map<string, (err: unknown) => void>()
    quit = vi.fn(async () => {
      this.status = 'end'
      return 'OK'
    })

    constructor(
      public readonly url: string,
      public readonly options: unknown,
    ) {
      FakeRedis.instances.push(this)
    }

    on(event: string, cb: (err: unknown) => void): this {
      this.handlers.set(event, cb)
      return this
    }

    emitError(err: unknown): void {
      this.handlers.get('error')?.(err)
    }
  }
  return { Redis: FakeRedis }
})

import { Redis } from 'ioredis'
import { getRedis, closeRedis } from './redis'

type FakeRedisInstance = Redis & {
  url: string
  options: unknown
  status: string
  quit: ReturnType<typeof vi.fn>
  emitError: (err: unknown) => void
}

function fakes(): FakeRedisInstance[] {
  return (Redis as unknown as { instances: FakeRedisInstance[] }).instances
}

const REDIS_KEY = Symbol.for('repkey.shared.cache.redis')
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_BETTER_AUTH_URL = process.env.BETTER_AUTH_URL

function clearStore(): void {
  delete (globalThis as Record<symbol, unknown>)[REDIS_KEY]
}

beforeEach(() => {
  clearStore()
  fakes().length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  clearStore()
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV
  if (ORIGINAL_BETTER_AUTH_URL === undefined) delete process.env.BETTER_AUTH_URL
  else process.env.BETTER_AUTH_URL = ORIGINAL_BETTER_AUTH_URL
  resetEnv()
})

describe('getRedis', () => {
  it('returns undefined and creates nothing when REDIS_URL is absent', () => {
    delete process.env.REDIS_URL
    resetEnv()

    expect(getRedis()).toBeUndefined()
    expect(fakes()).toHaveLength(0)
  })

  it('creates the client with cache-suitable options and dedups on the process store', () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    resetEnv()

    const first = getRedis()
    const second = getRedis()

    expect(fakes()).toHaveLength(1)
    expect(first).toBe(second)
    const created = fakes()[0]
    expect(created.url).toBe('redis://unit-test:6379')
    expect(created.options).toEqual({ maxRetriesPerRequest: 3, lazyConnect: true })
  })

  it('logs connection errors as non-fatal warnings in development', () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    process.env.NODE_ENV = 'development'
    resetEnv()

    getRedis()
    const failure = new Error('ECONNREFUSED')
    fakes()[0].emitError(failure)

    expect(loggerSpies.warn).toHaveBeenCalledWith(
      { err: failure },
      '[redis] connection error (dev mode — non-fatal)',
    )
    expect(loggerSpies.error).not.toHaveBeenCalled()
  })

  it('logs connection errors at error level outside development', () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    process.env.NODE_ENV = 'production'
    process.env.BETTER_AUTH_URL = 'https://app.example.test'
    process.env.PROCESSING_CELL = 'us'
    resetEnv()

    getRedis()
    const failure = new Error('READONLY')
    fakes()[0].emitError(failure)

    expect(loggerSpies.error).toHaveBeenCalledWith(
      { err: failure },
      '[redis] connection error',
    )
  })
})

describe('closeRedis', () => {
  it('quits a live client and resets the store so getRedis recreates', async () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    resetEnv()

    const first = getRedis() as unknown as FakeRedisInstance
    await closeRedis()

    expect(first.quit).toHaveBeenCalledOnce()
    expect(getRedis()).not.toBe(first)
    expect(fakes()).toHaveLength(2)
  })

  it('does not quit an already-ended client', async () => {
    process.env.REDIS_URL = 'redis://unit-test:6379'
    resetEnv()

    const client = getRedis() as unknown as FakeRedisInstance
    client.status = 'end'
    await closeRedis()

    expect(client.quit).not.toHaveBeenCalled()
  })

  it('no-ops when no client was ever created', async () => {
    await expect(closeRedis()).resolves.toBeUndefined()
    expect(fakes()).toHaveLength(0)
  })
})
