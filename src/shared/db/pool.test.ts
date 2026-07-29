import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isTransientConnectionError, getPool, closePool } from './pool'

vi.mock('pg', () => {
  class FakePool {
    static instances: FakePool[] = []
    readonly handlers = new Map<string, (err: unknown) => void>()
    end = vi.fn(async () => undefined)
    connect = vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    }))
    query = vi.fn(async () => ({ rows: [] }))

    constructor(public readonly options: unknown) {
      FakePool.instances.push(this)
    }

    on(event: string, cb: (err: unknown) => void): this {
      this.handlers.set(event, cb)
      return this
    }
  }
  return { Pool: FakePool }
})

import { Pool } from 'pg'

type FakePoolInstance = Pool & {
  options: { connectionString?: string; max?: number }
  end: ReturnType<typeof vi.fn>
}

function fakePools(): FakePoolInstance[] {
  return (Pool as unknown as { instances: FakePoolInstance[] }).instances
}

const POOL_KEY = Symbol.for('repkey.shared.db.pool')

function clearStore(): void {
  delete (globalThis as Record<symbol, unknown>)[POOL_KEY]
}

beforeEach(() => {
  clearStore()
  fakePools().length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  clearStore()
})

/**
 * The error shapes below are copied from the actual production logs:
 * Neon serverless Postgres cold-start / connection-recycling failures that
 * surface through pg-pool → Kysely → Better Auth as getActiveOrganization 500s.
 * If isTransientConnectionError stops recognising one of these, the pool-level
 * retry no longer fires and the cold-start 500 returns.
 */
describe('isTransientConnectionError', () => {
  it('recognises the Neon cold-start AggregateError (IPv4 ETIMEDOUT + IPv6 EHOSTUNREACH)', () => {
    // Verbatim shape from logs: AggregateError [ETIMEDOUT]
    const aggregate = Object.assign(new Error(''), {
      code: 'ETIMEDOUT',
      errors: [
        Object.assign(new Error('connect ETIMEDOUT 3.227.221.118:5432'), {
          code: 'ETIMEDOUT',
          errno: -60,
          syscall: 'connect',
          address: '3.227.221.118',
          port: 5432,
        }),
        Object.assign(
          new Error('connect EHOSTUNREACH 2600:1f18:700d:422c:f04:46d:4248:7967:5432'),
          {
            code: 'EHOSTUNREACH',
            errno: -65,
            syscall: 'connect',
            address: '2600:1f18:700d:422c:f04:46d:4248:7967',
            port: 5432,
          },
        ),
      ],
    })
    expect(isTransientConnectionError(aggregate)).toBe(true)
  })

  it('recognises a bare ETIMEDOUT', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
    expect(isTransientConnectionError(err)).toBe(true)
  })

  it('recognises ECONNRESET and EPIPE (recycled-connection symptoms)', () => {
    expect(
      isTransientConnectionError(Object.assign(new Error('x'), { code: 'ECONNRESET' })),
    ).toBe(true)
    expect(
      isTransientConnectionError(Object.assign(new Error('x'), { code: 'EPIPE' })),
    ).toBe(true)
  })

  it('recognises "Connection terminated" by message (no .code)', () => {
    const err = new Error('Connection terminated during query')
    expect(isTransientConnectionError(err)).toBe(true)
  })

  it('recognises "server closed the connection unexpectedly"', () => {
    const err = new Error('server closed the connection unexpectedly')
    expect(isTransientConnectionError(err)).toBe(true)
  })

  it('does NOT classify a domain error as transient', () => {
    const domainErr = Object.assign(new Error('forbidden'), { code: 'no_active_org' })
    expect(isTransientConnectionError(domainErr)).toBe(false)
  })

  it('does NOT classify a generic Error as transient', () => {
    expect(isTransientConnectionError(new Error('syntax error at or near'))).toBe(false)
  })

  it('does NOT crash on null/undefined/primitives', () => {
    expect(isTransientConnectionError(null)).toBe(false)
    expect(isTransientConnectionError(undefined)).toBe(false)
    expect(isTransientConnectionError('string error')).toBe(false)
    expect(isTransientConnectionError(42)).toBe(false)
  })
})

// BQC-7.1 — process-wide pool singleton (Symbol.for store: the production
// build bundles this module twice, so the store must be global, not module
// scope) and the graceful-shutdown close semantics.
describe('getPool / closePool (BQC-7.1)', () => {
  it('creates one pool with the Neon-safe options and dedups on the process store', () => {
    const first = getPool()
    const second = getPool()

    expect(fakePools()).toHaveLength(1)
    expect(first).toBe(second)
    expect(fakePools()[0].options).toMatchObject({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 30_000,
    })
  })

  it('closePool ends the pool and resets the store so getPool recreates', async () => {
    const first = getPool() as FakePoolInstance

    await closePool()
    expect(first.end).toHaveBeenCalledOnce()

    const second = getPool()
    expect(second).not.toBe(first)
    expect(fakePools()).toHaveLength(2)
  })

  it('closePool no-ops when no pool was ever created', async () => {
    await expect(closePool()).resolves.toBeUndefined()
    expect(fakePools()).toHaveLength(0)
  })
})
