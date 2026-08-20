import type { Redis } from 'ioredis'

export const PROVIDER_EPHEMERAL_NAMESPACES = [
  'oauth-state',
  'opaque-reference',
  'authorization-lease',
  'invalidation-dedupe',
] as const
export type ProviderEphemeralNamespace = (typeof PROVIDER_EPHEMERAL_NAMESPACES)[number]

const PROVIDER_EPHEMERAL_NAMESPACE_ALLOWED: Readonly<
  Record<ProviderEphemeralNamespace, true>
> = {
  'oauth-state': true,
  'opaque-reference': true,
  'authorization-lease': true,
  'invalidation-dedupe': true,
}
const SAFE_KEY = /^[A-Za-z0-9_-]{32,128}$/
const MAX_VALUE_BYTES = 5 * 1024 * 1024

export function assertProviderEphemeralLocation(
  namespace: ProviderEphemeralNamespace,
  key: string,
): void {
  if (
    typeof namespace !== 'string' ||
    !Object.prototype.hasOwnProperty.call(PROVIDER_EPHEMERAL_NAMESPACE_ALLOWED, namespace)
  ) {
    throw new Error('provider ephemeral namespace is malformed')
  }
  if (!SAFE_KEY.test(key)) throw new Error('provider ephemeral key is malformed')
}

export function assertProviderEphemeralValue(value: string): void {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    throw new Error('provider ephemeral value is outside the bounded range')
  }
}

export function assertProviderEphemeralTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400) {
    throw new Error('provider ephemeral TTL is outside the bounded range')
  }
}

const MAX_COMPARE_AND_SWAP_ENTRIES = 256

export type ProviderEphemeralCompareAndSwapEntry = Readonly<{
  key: string
  expectedValue: string | null
  next: Readonly<{ value: string; ttlSeconds: number }> | null
}>

function assertCompareAndSwapEntries(
  namespace: ProviderEphemeralNamespace,
  entries: readonly ProviderEphemeralCompareAndSwapEntry[],
): void {
  if (entries.length < 1 || entries.length > MAX_COMPARE_AND_SWAP_ENTRIES) {
    throw new Error('provider ephemeral batch is outside the bounded range')
  }
  const keys = new Set<string>()
  for (const entry of entries) {
    assertProviderEphemeralLocation(namespace, entry.key)
    if (keys.has(entry.key)) {
      throw new Error('provider ephemeral batch contains duplicate keys')
    }
    keys.add(entry.key)
    if (entry.expectedValue !== null) {
      assertProviderEphemeralValue(entry.expectedValue)
    }
    if (entry.next !== null) {
      assertProviderEphemeralValue(entry.next.value)
      assertProviderEphemeralTtl(entry.next.ttlSeconds)
    }
  }
}

const COMPARE_AND_SWAP_MANY_LUA = `
for i = 1, #KEYS do
  local offset = (i - 1) * 5
  local current = redis.call('GET', KEYS[i])
  if ARGV[offset + 1] == '0' then
    if current then return 0 end
  elseif not current or current ~= ARGV[offset + 2] then
    return 0
  end
end
for i = 1, #KEYS do
  local offset = (i - 1) * 5
  if ARGV[offset + 3] == '0' then
    redis.call('DEL', KEYS[i])
  else
    redis.call('SET', KEYS[i], ARGV[offset + 4], 'EX', ARGV[offset + 5])
  end
end
return 1
`

export type ProviderEphemeralStore = Readonly<{
  putIfAbsent: (
    namespace: ProviderEphemeralNamespace,
    key: string,
    value: string,
    ttlSeconds: number,
  ) => Promise<boolean>
  read: (
    namespace: ProviderEphemeralNamespace,
    key: string,
  ) => Promise<string | undefined>
  consume: (
    namespace: ProviderEphemeralNamespace,
    key: string,
  ) => Promise<string | undefined>
  consumeIfEquals: (
    namespace: ProviderEphemeralNamespace,
    key: string,
    expectedValue: string,
  ) => Promise<'consumed' | 'not_found' | 'mismatch'>
  replaceIfEquals: (
    namespace: ProviderEphemeralNamespace,
    key: string,
    expectedValue: string,
    nextValue: string,
    ttlSeconds: number,
  ) => Promise<'replaced' | 'not_found' | 'mismatch'>
  compareAndSwapMany: (
    namespace: ProviderEphemeralNamespace,
    entries: readonly ProviderEphemeralCompareAndSwapEntry[],
  ) => Promise<boolean>
  remove: (namespace: ProviderEphemeralNamespace, key: string) => Promise<void>
}>

function redisKey(namespace: ProviderEphemeralNamespace, key: string): string {
  assertProviderEphemeralLocation(namespace, key)
  return `provider-ephemeral:{${namespace}}:${key}`
}

export function createRedisProviderEphemeralStore(redis: Redis): ProviderEphemeralStore {
  return Object.freeze({
    putIfAbsent: async (namespace, key, value, ttlSeconds) => {
      assertProviderEphemeralTtl(ttlSeconds)
      assertProviderEphemeralValue(value)
      const result = await redis.set(
        redisKey(namespace, key),
        value,
        'EX',
        ttlSeconds,
        'NX',
      )
      return result === 'OK'
    },
    read: async (namespace, key) =>
      (await redis.get(redisKey(namespace, key))) ?? undefined,
    consume: async (namespace, key) =>
      (await redis.getdel(redisKey(namespace, key))) ?? undefined,
    consumeIfEquals: async (namespace, key, expectedValue) => {
      assertProviderEphemeralValue(expectedValue)
      const result = (await redis.eval(
        "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; if v~=ARGV[1] then return 1 end; redis.call('DEL',KEYS[1]); return 2",
        1,
        redisKey(namespace, key),
        expectedValue,
      )) as number
      if (result === 2) return 'consumed'
      if (result === 1) return 'mismatch'
      return 'not_found'
    },
    replaceIfEquals: async (namespace, key, expectedValue, nextValue, ttlSeconds) => {
      assertProviderEphemeralTtl(ttlSeconds)
      assertProviderEphemeralValue(expectedValue)
      assertProviderEphemeralValue(nextValue)
      const result = (await redis.eval(
        "local v=redis.call('GET',KEYS[1]); if not v then return 0 end; if v~=ARGV[1] then return 1 end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 2",
        1,
        redisKey(namespace, key),
        expectedValue,
        nextValue,
        ttlSeconds,
      )) as number
      if (result === 2) return 'replaced'
      if (result === 1) return 'mismatch'
      return 'not_found'
    },
    compareAndSwapMany: async (namespace, entries) => {
      assertCompareAndSwapEntries(namespace, entries)
      const keys = entries.map((entry) => redisKey(namespace, entry.key))
      const args = entries.flatMap((entry) => [
        entry.expectedValue === null ? '0' : '1',
        entry.expectedValue ?? '',
        entry.next === null ? '0' : '1',
        entry.next?.value ?? '',
        String(entry.next?.ttlSeconds ?? 0),
      ])
      const result = await redis.eval(
        COMPARE_AND_SWAP_MANY_LUA,
        keys.length,
        ...keys,
        ...args,
      )
      return result === 1
    },
    remove: async (namespace, key) => {
      await redis.del(redisKey(namespace, key))
    },
  })
}
