import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROVIDER_EPHEMERAL_NAMESPACES,
  type ProviderEphemeralNamespace,
  type ProviderEphemeralStore,
} from './provider-ephemeral-store'

export type ProviderEphemeralStoreHarness = Readonly<{
  store: ProviderEphemeralStore
  /** Moves the store's clock forward: a fake clock, or a real wait. */
  advance: (ms: number) => Promise<void>
}>

const EXPIRY_STEP_MS = 1_100

/**
 * The behaviour every ProviderEphemeralStore must show, so the in-memory fake
 * used across the unit suites cannot drift from the Redis store that runs in
 * production. Callers return undefined when their backend is unavailable.
 */
export function describeProviderEphemeralStoreContract(
  label: string,
  create: () => Promise<ProviderEphemeralStoreHarness | undefined>,
): void {
  describe(`ProviderEphemeralStore contract: ${label}`, () => {
    const used: { namespace: ProviderEphemeralNamespace; key: string }[] = []
    let current: ProviderEphemeralStoreHarness | undefined

    const freshKey = () => randomBytes(32).toString('base64url')
    const track = (namespace: ProviderEphemeralNamespace, key: string) => {
      used.push({ namespace, key })
      return key
    }
    const harness = async () => {
      current = await create()
      return current
    }

    afterEach(async () => {
      const store = current?.store
      const keys = used.splice(0)
      current = undefined
      if (!store) return
      for (const { namespace, key } of keys) await store.remove(namespace, key)
    })

    it('stores a value once and keeps the first writer on a second put', async () => {
      const h = await harness()
      if (!h) return
      const key = track('oauth-state', freshKey())

      await expect(h.store.putIfAbsent('oauth-state', key, 'first', 60)).resolves.toBe(
        true,
      )
      await expect(h.store.putIfAbsent('oauth-state', key, 'second', 60)).resolves.toBe(
        false,
      )
      await expect(h.store.read('oauth-state', key)).resolves.toBe('first')
    })

    it('reads nothing for a key that was never written', async () => {
      const h = await harness()
      if (!h) return

      await expect(h.store.read('oauth-state', freshKey())).resolves.toBeUndefined()
      await expect(h.store.consume('oauth-state', freshKey())).resolves.toBeUndefined()
    })

    it('round-trips the exact value, including non-ASCII text and NUL', async () => {
      const h = await harness()
      if (!h) return
      const key = track('opaque-reference', freshKey())
      const value = 'é✓\u0000{"a":1}'

      await h.store.putIfAbsent('opaque-reference', key, value, 60)

      await expect(h.store.read('opaque-reference', key)).resolves.toBe(value)
    })

    it('keeps the same key apart in different namespaces', async () => {
      const h = await harness()
      if (!h) return
      const key = freshKey()
      track('oauth-state', key)
      track('authorization-lease', key)

      await h.store.putIfAbsent('oauth-state', key, 'state', 60)

      await expect(h.store.read('authorization-lease', key)).resolves.toBeUndefined()
      await expect(
        h.store.putIfAbsent('authorization-lease', key, 'lease', 60),
      ).resolves.toBe(true)
      await expect(h.store.read('oauth-state', key)).resolves.toBe('state')
    })

    it('consumes a value exactly once', async () => {
      const h = await harness()
      if (!h) return
      const key = track('oauth-state', freshKey())
      await h.store.putIfAbsent('oauth-state', key, 'once', 60)

      await expect(h.store.consume('oauth-state', key)).resolves.toBe('once')
      await expect(h.store.consume('oauth-state', key)).resolves.toBeUndefined()
      await expect(h.store.read('oauth-state', key)).resolves.toBeUndefined()
    })

    it('removes a value, and removing a missing key is not an error', async () => {
      const h = await harness()
      if (!h) return
      const key = track('oauth-state', freshKey())
      await h.store.putIfAbsent('oauth-state', key, 'gone', 60)

      await h.store.remove('oauth-state', key)
      await h.store.remove('oauth-state', key)

      await expect(h.store.read('oauth-state', key)).resolves.toBeUndefined()
    })

    it('preserves a value on compare mismatch and consumes it on exact match', async () => {
      const h = await harness()
      if (!h) return
      const key = track('oauth-state', freshKey())
      await h.store.putIfAbsent('oauth-state', key, 'protected-value', 60)

      await expect(h.store.consumeIfEquals('oauth-state', key, 'wrong')).resolves.toBe(
        'mismatch',
      )
      await expect(h.store.read('oauth-state', key)).resolves.toBe('protected-value')
      await expect(
        h.store.consumeIfEquals('oauth-state', key, 'protected-value'),
      ).resolves.toBe('consumed')
      await expect(h.store.read('oauth-state', key)).resolves.toBeUndefined()
      await expect(
        h.store.consumeIfEquals('oauth-state', key, 'protected-value'),
      ).resolves.toBe('not_found')
    })

    it('allows exactly one concurrent compare-and-consume winner', async () => {
      const h = await harness()
      if (!h) return
      const key = track('authorization-lease', freshKey())
      await h.store.putIfAbsent('authorization-lease', key, 'lease', 60)

      const results = await Promise.all([
        h.store.consumeIfEquals('authorization-lease', key, 'lease'),
        h.store.consumeIfEquals('authorization-lease', key, 'lease'),
      ])

      expect([...results].sort()).toEqual(['consumed', 'not_found'])
    })

    it('replaces only the exact observed value and refreshes its bounded TTL', async () => {
      const h = await harness()
      if (!h) return
      const key = track('authorization-lease', freshKey())
      await h.store.putIfAbsent('authorization-lease', key, 'lease-1', 1)

      await expect(
        h.store.replaceIfEquals('authorization-lease', key, 'wrong', 'lease-2', 3),
      ).resolves.toBe('mismatch')
      await expect(
        h.store.replaceIfEquals('authorization-lease', key, 'lease-1', 'lease-2', 3),
      ).resolves.toBe('replaced')

      await h.advance(EXPIRY_STEP_MS)
      await expect(h.store.read('authorization-lease', key)).resolves.toBe('lease-2')
      await h.advance(2 * EXPIRY_STEP_MS)
      await expect(h.store.read('authorization-lease', key)).resolves.toBeUndefined()
    })

    it('expires a value and then allows a same-key replacement', async () => {
      const h = await harness()
      if (!h) return
      const key = track('opaque-reference', freshKey())
      await h.store.putIfAbsent('opaque-reference', key, 'old', 1)

      await h.advance(EXPIRY_STEP_MS)

      await expect(h.store.read('opaque-reference', key)).resolves.toBeUndefined()
      await expect(h.store.putIfAbsent('opaque-reference', key, 'new', 60)).resolves.toBe(
        true,
      )
      await expect(h.store.read('opaque-reference', key)).resolves.toBe('new')
    })

    it('treats an expired value as absent for every compare and consume', async () => {
      const h = await harness()
      if (!h) return
      const key = track('authorization-lease', freshKey())
      await h.store.putIfAbsent('authorization-lease', key, 'lease', 1)

      await h.advance(EXPIRY_STEP_MS)

      await expect(h.store.consume('authorization-lease', key)).resolves.toBeUndefined()
      await h.store.putIfAbsent('authorization-lease', key, 'lease', 1)
      await h.advance(EXPIRY_STEP_MS)
      await expect(
        h.store.consumeIfEquals('authorization-lease', key, 'lease'),
      ).resolves.toBe('not_found')
      await expect(
        h.store.replaceIfEquals('authorization-lease', key, 'lease', 'next', 60),
      ).resolves.toBe('not_found')
      await expect(h.store.read('authorization-lease', key)).resolves.toBeUndefined()
    })

    it('applies a bounded multi-key compare-and-swap atomically', async () => {
      const h = await harness()
      if (!h) return
      const first = track('opaque-reference', freshKey())
      const second = track('opaque-reference', freshKey())
      await h.store.putIfAbsent('opaque-reference', first, 'old-index', 60)

      await expect(
        h.store.compareAndSwapMany('opaque-reference', [
          {
            key: first,
            expectedValue: 'old-index',
            next: { value: 'new-index', ttlSeconds: 60 },
          },
          {
            key: second,
            expectedValue: null,
            next: { value: 'candidate', ttlSeconds: 60 },
          },
        ]),
      ).resolves.toBe(true)
      await expect(h.store.read('opaque-reference', first)).resolves.toBe('new-index')
      await expect(h.store.read('opaque-reference', second)).resolves.toBe('candidate')
    })

    it('leaves every key unchanged when one batch precondition loses a race', async () => {
      const h = await harness()
      if (!h) return
      const first = track('opaque-reference', freshKey())
      const second = track('opaque-reference', freshKey())
      await h.store.putIfAbsent('opaque-reference', first, 'changed-by-winner', 60)

      await expect(
        h.store.compareAndSwapMany('opaque-reference', [
          {
            key: first,
            expectedValue: 'stale-observation',
            next: { value: 'losing-write', ttlSeconds: 60 },
          },
          {
            key: second,
            expectedValue: null,
            next: { value: 'orphan', ttlSeconds: 60 },
          },
        ]),
      ).resolves.toBe(false)
      await expect(h.store.read('opaque-reference', first)).resolves.toBe(
        'changed-by-winner',
      )
      await expect(h.store.read('opaque-reference', second)).resolves.toBeUndefined()
    })

    it('atomically removes exact observed records without deleting replacements', async () => {
      const h = await harness()
      if (!h) return
      const first = track('opaque-reference', freshKey())
      const second = track('opaque-reference', freshKey())
      await h.store.putIfAbsent('opaque-reference', first, 'record-1', 60)
      await h.store.putIfAbsent('opaque-reference', second, 'record-2', 60)

      await expect(
        h.store.compareAndSwapMany('opaque-reference', [
          { key: first, expectedValue: 'record-1', next: null },
          { key: second, expectedValue: 'stale', next: null },
        ]),
      ).resolves.toBe(false)
      await expect(h.store.read('opaque-reference', first)).resolves.toBe('record-1')
      await expect(h.store.read('opaque-reference', second)).resolves.toBe('record-2')

      await expect(
        h.store.compareAndSwapMany('opaque-reference', [
          { key: first, expectedValue: 'record-1', next: null },
          { key: second, expectedValue: 'record-2', next: null },
        ]),
      ).resolves.toBe(true)
      await expect(h.store.read('opaque-reference', first)).resolves.toBeUndefined()
      await expect(h.store.read('opaque-reference', second)).resolves.toBeUndefined()
    })

    it('lets a batch create a key that expired, and refuses one that is live', async () => {
      const h = await harness()
      if (!h) return
      const key = track('opaque-reference', freshKey())
      const create = [
        {
          key,
          expectedValue: null,
          next: { value: 'created', ttlSeconds: 60 },
        },
      ]
      await h.store.putIfAbsent('opaque-reference', key, 'short-lived', 1)

      await expect(h.store.compareAndSwapMany('opaque-reference', create)).resolves.toBe(
        false,
      )
      await h.advance(EXPIRY_STEP_MS)
      await expect(h.store.compareAndSwapMany('opaque-reference', create)).resolves.toBe(
        true,
      )
      await expect(h.store.read('opaque-reference', key)).resolves.toBe('created')
    })

    it('rejects empty, oversized and duplicate-key batches and writes nothing', async () => {
      const h = await harness()
      if (!h) return
      const key = track('opaque-reference', freshKey())
      const write = { key, expectedValue: null, next: { value: 'v', ttlSeconds: 60 } }
      const oversized = Array.from({ length: 257 }, () => ({
        ...write,
        key: track('opaque-reference', freshKey()),
      }))

      for (const batch of [[], oversized, [write, write]]) {
        await expect(
          h.store.compareAndSwapMany('opaque-reference', batch),
        ).rejects.toThrow(/^provider ephemeral /u)
      }
      await expect(h.store.read('opaque-reference', key)).resolves.toBeUndefined()
    })

    it('rejects malformed namespaces, keys, values, and TTLs without echoing inputs', async () => {
      const h = await harness()
      if (!h) return
      const secret = '!provider-secret-that-must-not-appear'
      const key = track('oauth-state', freshKey())
      const attempts: ReadonlyArray<() => Promise<boolean>> = [
        () =>
          h.store.putIfAbsent(
            'unexpected' as ProviderEphemeralNamespace,
            key,
            'value',
            60,
          ),
        () => h.store.putIfAbsent('oauth-state', secret, 'value', 60),
        () =>
          h.store.putIfAbsent('oauth-state', key, 'x'.repeat(5 * 1024 * 1024 + 1), 60),
        () => h.store.putIfAbsent('oauth-state', key, 'value', 86_401),
        () => h.store.putIfAbsent('oauth-state', key, 'value', 0),
        () => h.store.putIfAbsent('oauth-state', key, 'value', 1.5),
      ]

      for (const attempt of attempts) {
        await expect(attempt()).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof Error &&
            error.message.startsWith('provider ephemeral ') &&
            !error.message.includes(secret),
        )
      }
      await expect(h.store.read('oauth-state', key)).resolves.toBeUndefined()
    })

    it('knows every namespace it is asked to serve', () => {
      expect(PROVIDER_EPHEMERAL_NAMESPACES).toEqual([
        'oauth-state',
        'opaque-reference',
        'authorization-lease',
        'invalidation-dedupe',
      ])
    })
  })
}
