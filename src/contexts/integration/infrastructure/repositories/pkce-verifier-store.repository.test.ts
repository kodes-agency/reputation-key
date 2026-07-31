// Integration context — PKCE verifier store integration tests (BQC-7.6).
//
// Runs in the integration project against a REAL Redis (REDIS_URL from the
// canonical test environment): the production store's one-time-use and TTL
// semantics are Redis commands (SET EX + GETDEL) and must be proven against
// the real thing. The in-memory dev fallback is covered here too (injected
// clock for expiry).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Redis } from 'ioredis'
import { getEnv } from '#/shared/config/env'
import {
  createRedisPkceVerifierStore,
  createInMemoryPkceVerifierStore,
  PKCE_STORE_KEY_PREFIX,
} from './pkce-verifier-store.repository'

describe('createRedisPkceVerifierStore (real Redis)', () => {
  let redis: Redis

  beforeAll(() => {
    redis = new Redis(getEnv().REDIS_URL!, { lazyConnect: false })
  })

  afterAll(async () => {
    await redis.quit()
  })

  beforeEach(async () => {
    // Test-scope cleanup: remove any leftover probe keys.
    const keys = await redis.keys(`${PKCE_STORE_KEY_PREFIX}test-*`)
    if (keys.length > 0) await redis.del(...keys)
  })

  it('save → redeem returns the verifier exactly once (one-time use)', async () => {
    const store = createRedisPkceVerifierStore(redis)
    await store.save('test-nonce-1', 'verifier-abc', 600)

    expect(await store.redeem('test-nonce-1')).toBe('verifier-abc')
    // Second redeem: the key was deleted atomically — replay fails closed.
    expect(await store.redeem('test-nonce-1')).toBeUndefined()
  })

  it('redeem of an unknown nonce is undefined (fail closed)', async () => {
    const store = createRedisPkceVerifierStore(redis)
    expect(await store.redeem('test-nonce-never-saved')).toBeUndefined()
  })

  it('persists with a TTL matching the OAuth state lifetime', async () => {
    const store = createRedisPkceVerifierStore(redis)
    await store.save('test-nonce-ttl', 'verifier-xyz', 600)

    const ttl = await redis.ttl(`${PKCE_STORE_KEY_PREFIX}test-nonce-ttl`)
    expect(ttl).toBeGreaterThan(590)
    expect(ttl).toBeLessThanOrEqual(600)
  })

  it('expired verifiers are gone (short TTL)', async () => {
    const store = createRedisPkceVerifierStore(redis)
    await store.save('test-nonce-short', 'verifier-short', 1)
    await new Promise((r) => setTimeout(r, 1100))
    expect(await store.redeem('test-nonce-short')).toBeUndefined()
  }, 10_000)
})

describe('createInMemoryPkceVerifierStore (dev fallback)', () => {
  it('save → redeem is one-time', async () => {
    const store = createInMemoryPkceVerifierStore()
    await store.save('n1', 'v1', 600)
    expect(await store.redeem('n1')).toBe('v1')
    expect(await store.redeem('n1')).toBeUndefined()
  })

  it('expires entries by the injected clock', async () => {
    let now = 1_000_000
    const store = createInMemoryPkceVerifierStore(() => now)
    await store.save('n2', 'v2', 10)
    now += 11_000
    expect(await store.redeem('n2')).toBeUndefined()
  })

  it('keeps separate nonces independent', async () => {
    const store = createInMemoryPkceVerifierStore()
    await store.save('a', 'va', 600)
    await store.save('b', 'vb', 600)
    expect(await store.redeem('a')).toBe('va')
    expect(await store.redeem('b')).toBe('vb')
  })
})
