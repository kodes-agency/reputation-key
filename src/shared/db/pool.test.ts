import { describe, it, expect } from 'vitest'
import { isTransientConnectionError } from './pool'

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
