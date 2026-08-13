import { describe, expect, it } from 'vitest'
import { createInMemoryProviderEphemeralStore } from './in-memory-store'
import type { ProviderEphemeralNamespace } from './provider-ephemeral-store'

const KEY = 'a'.repeat(43)

describe('ProviderEphemeralStore contract', () => {
  it('preserves a value on compare mismatch and consumes it on exact match', async () => {
    const store = createInMemoryProviderEphemeralStore()
    await expect(
      store.putIfAbsent('oauth-state', KEY, 'protected-value', 60),
    ).resolves.toBe(true)
    await expect(store.consumeIfEquals('oauth-state', KEY, 'wrong')).resolves.toBe(
      'mismatch',
    )
    await expect(store.read('oauth-state', KEY)).resolves.toBe('protected-value')
    await expect(
      store.consumeIfEquals('oauth-state', KEY, 'protected-value'),
    ).resolves.toBe('consumed')
    await expect(store.read('oauth-state', KEY)).resolves.toBeUndefined()
  })

  it('allows exactly one concurrent compare-and-consume winner', async () => {
    const store = createInMemoryProviderEphemeralStore()
    await store.putIfAbsent('authorization-lease', KEY, 'lease', 60)
    const results = await Promise.all([
      store.consumeIfEquals('authorization-lease', KEY, 'lease'),
      store.consumeIfEquals('authorization-lease', KEY, 'lease'),
    ])
    expect(results.sort()).toEqual(['consumed', 'not_found'])
  })

  it('replaces only the exact observed value and refreshes its bounded TTL', async () => {
    let now = 1_000
    const store = createInMemoryProviderEphemeralStore(() => now)
    await store.putIfAbsent('authorization-lease', KEY, 'lease-1', 1)
    await expect(
      store.replaceIfEquals('authorization-lease', KEY, 'wrong', 'lease-2', 2),
    ).resolves.toBe('mismatch')
    await expect(
      store.replaceIfEquals('authorization-lease', KEY, 'lease-1', 'lease-2', 2),
    ).resolves.toBe('replaced')
    now += 1_500
    await expect(store.read('authorization-lease', KEY)).resolves.toBe('lease-2')
  })

  it('expires records and allows a same-key replacement', async () => {
    let now = 1_000
    const store = createInMemoryProviderEphemeralStore(() => now)
    await store.putIfAbsent('opaque-reference', KEY, 'old', 1)
    now += 1_001
    await expect(store.read('opaque-reference', KEY)).resolves.toBeUndefined()
    await expect(store.putIfAbsent('opaque-reference', KEY, 'new', 1)).resolves.toBe(true)
  })

  it('applies a bounded multi-key compare-and-swap atomically', async () => {
    const store = createInMemoryProviderEphemeralStore()
    const secondKey = 'b'.repeat(43)
    await store.putIfAbsent('opaque-reference', KEY, 'old-index', 60)

    await expect(
      store.compareAndSwapMany('opaque-reference', [
        {
          key: KEY,
          expectedValue: 'old-index',
          next: { value: 'new-index', ttlSeconds: 60 },
        },
        {
          key: secondKey,
          expectedValue: null,
          next: { value: 'candidate', ttlSeconds: 60 },
        },
      ]),
    ).resolves.toBe(true)
    await expect(store.read('opaque-reference', KEY)).resolves.toBe('new-index')
    await expect(store.read('opaque-reference', secondKey)).resolves.toBe('candidate')
  })

  it('leaves every key unchanged when one batch precondition loses a race', async () => {
    const store = createInMemoryProviderEphemeralStore()
    const secondKey = 'b'.repeat(43)
    await store.putIfAbsent('opaque-reference', KEY, 'changed-by-winner', 60)

    await expect(
      store.compareAndSwapMany('opaque-reference', [
        {
          key: KEY,
          expectedValue: 'stale-observation',
          next: { value: 'losing-write', ttlSeconds: 60 },
        },
        {
          key: secondKey,
          expectedValue: null,
          next: { value: 'orphan', ttlSeconds: 60 },
        },
      ]),
    ).resolves.toBe(false)
    await expect(store.read('opaque-reference', KEY)).resolves.toBe('changed-by-winner')
    await expect(store.read('opaque-reference', secondKey)).resolves.toBeUndefined()
  })

  it('atomically removes exact observed records without deleting replacements', async () => {
    const store = createInMemoryProviderEphemeralStore()
    const secondKey = 'b'.repeat(43)
    await store.putIfAbsent('opaque-reference', KEY, 'record-1', 60)
    await store.putIfAbsent('opaque-reference', secondKey, 'record-2', 60)

    await expect(
      store.compareAndSwapMany('opaque-reference', [
        { key: KEY, expectedValue: 'record-1', next: null },
        { key: secondKey, expectedValue: 'stale', next: null },
      ]),
    ).resolves.toBe(false)
    await expect(store.read('opaque-reference', KEY)).resolves.toBe('record-1')
    await expect(store.read('opaque-reference', secondKey)).resolves.toBe('record-2')

    await expect(
      store.compareAndSwapMany('opaque-reference', [
        { key: KEY, expectedValue: 'record-1', next: null },
        { key: secondKey, expectedValue: 'record-2', next: null },
      ]),
    ).resolves.toBe(true)
    await expect(store.read('opaque-reference', KEY)).resolves.toBeUndefined()
    await expect(store.read('opaque-reference', secondKey)).resolves.toBeUndefined()
  })
  it('rejects malformed namespaces, keys, values, and TTLs without echoing inputs', async () => {
    const store = createInMemoryProviderEphemeralStore()
    const secret = '!provider-secret-that-must-not-appear'
    const attempts: ReadonlyArray<() => Promise<boolean>> = [
      () =>
        store.putIfAbsent('unexpected' as ProviderEphemeralNamespace, KEY, 'value', 60),
      () => store.putIfAbsent('oauth-state', secret, 'value', 60),
      () => store.putIfAbsent('oauth-state', KEY, 'x'.repeat(5 * 1024 * 1024 + 1), 60),
      () => store.putIfAbsent('oauth-state', KEY, 'value', 86_401),
    ]
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof Error &&
          error.message.startsWith('provider ephemeral ') &&
          !error.message.includes(secret),
      )
    }
  })
})
