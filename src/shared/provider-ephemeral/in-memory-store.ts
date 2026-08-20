import {
  assertProviderEphemeralLocation,
  assertProviderEphemeralTtl,
  assertProviderEphemeralValue,
  type ProviderEphemeralNamespace,
  type ProviderEphemeralStore,
} from '#/shared/provider-ephemeral/provider-ephemeral-store'

export function createInMemoryProviderEphemeralStore(
  nowMs: () => number = Date.now,
): ProviderEphemeralStore {
  const entries = new Map<string, { value: string; expiresAtMs: number }>()
  const composite = (namespace: ProviderEphemeralNamespace, key: string) => {
    assertProviderEphemeralLocation(namespace, key)
    return `${namespace}:${key}`
  }
  const expiresAt = (ttlSeconds: number) => {
    assertProviderEphemeralTtl(ttlSeconds)
    return nowMs() + ttlSeconds * 1000
  }
  return Object.freeze({
    putIfAbsent: async (namespace, key, value, ttlSeconds) => {
      assertProviderEphemeralValue(value)
      const id = composite(namespace, key)
      const existing = entries.get(id)
      if (existing && existing.expiresAtMs > nowMs()) return false
      entries.set(id, { value, expiresAtMs: expiresAt(ttlSeconds) })
      return true
    },
    read: async (namespace, key) => {
      const entry = entries.get(composite(namespace, key))
      if (!entry || entry.expiresAtMs <= nowMs()) return undefined
      return entry.value
    },
    consume: async (namespace, key) => {
      const id = composite(namespace, key)
      const entry = entries.get(id)
      entries.delete(id)
      if (!entry || entry.expiresAtMs <= nowMs()) return undefined
      return entry.value
    },
    consumeIfEquals: async (namespace, key, expectedValue) => {
      assertProviderEphemeralValue(expectedValue)
      const id = composite(namespace, key)
      const entry = entries.get(id)
      if (!entry || entry.expiresAtMs <= nowMs()) {
        entries.delete(id)
        return 'not_found'
      }
      if (entry.value !== expectedValue) return 'mismatch'
      entries.delete(id)
      return 'consumed'
    },
    replaceIfEquals: async (namespace, key, expectedValue, nextValue, ttlSeconds) => {
      assertProviderEphemeralValue(expectedValue)
      assertProviderEphemeralValue(nextValue)
      const id = composite(namespace, key)
      const entry = entries.get(id)
      if (!entry || entry.expiresAtMs <= nowMs()) {
        entries.delete(id)
        return 'not_found'
      }
      if (entry.value !== expectedValue) return 'mismatch'
      entries.set(id, {
        value: nextValue,
        expiresAtMs: expiresAt(ttlSeconds),
      })
      return 'replaced'
    },
    compareAndSwapMany: async (namespace, batch) => {
      const observed = batch.map((entry) => {
        assertProviderEphemeralLocation(namespace, entry.key)
        if (entry.expectedValue !== null) {
          assertProviderEphemeralValue(entry.expectedValue)
        }
        if (entry.next !== null) {
          assertProviderEphemeralValue(entry.next.value)
          assertProviderEphemeralTtl(entry.next.ttlSeconds)
        }
        return { entry, id: composite(namespace, entry.key) }
      })
      if (
        batch.length < 1 ||
        batch.length > 256 ||
        new Set(observed.map(({ id }) => id)).size !== observed.length
      ) {
        throw new Error('provider ephemeral batch is outside the bounded range')
      }
      const now = nowMs()
      for (const { entry, id } of observed) {
        const current = entries.get(id)
        const currentValue =
          current && current.expiresAtMs > now ? current.value : undefined
        if (
          (entry.expectedValue === null && currentValue !== undefined) ||
          (entry.expectedValue !== null && currentValue !== entry.expectedValue)
        ) {
          return false
        }
      }
      for (const { entry, id } of observed) {
        if (entry.next === null) {
          entries.delete(id)
        } else {
          entries.set(id, {
            value: entry.next.value,
            expiresAtMs: expiresAt(entry.next.ttlSeconds),
          })
        }
      }
      return true
    },
    remove: async (namespace, key) => {
      entries.delete(composite(namespace, key))
    },
  })
}
