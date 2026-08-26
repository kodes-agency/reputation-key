import { createHmac } from 'node:crypto'
import type { BetterAuthRateLimitStorage, RateLimit } from 'better-auth'
import type { Redis } from 'ioredis'

const DEFAULT_KEY_PREFIX = 'ratelimit:better-auth:v1'
const DEFAULT_WINDOW_SECONDS = 10

type StorageOptions = Readonly<{
  keyPrefix?: string
  defaultWindowSeconds?: number
  keyHmacSecret: string
}>

// Uses Redis TIME so replicas with slightly different system clocks still
// agree on one window. Allowed requests advance the rolling window; rejected
// requests do not extend a lockout. The check, increment, and expiry update
// are one operation, so concurrent replicas cannot all pass a stale read.
const CONSUME_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local windowMs = tonumber(ARGV[1])
local maximum = tonumber(ARGV[2])
local values = redis.call('HMGET', KEYS[1], 'count', 'lastRequest')
local count = tonumber(values[1])
local lastRequest = tonumber(values[2])

if count == nil or lastRequest == nil or now - lastRequest > windowMs then
  redis.call('HSET', KEYS[1], 'count', 1, 'lastRequest', now)
  redis.call('PEXPIRE', KEYS[1], windowMs)
  return {1, windowMs}
end

local ttlMs = redis.call('PTTL', KEYS[1])
if ttlMs < 1 then
  redis.call('PEXPIRE', KEYS[1], windowMs)
  ttlMs = windowMs
end

if count >= maximum then
  return {0, ttlMs}
end

redis.call('HINCRBY', KEYS[1], 'count', 1)
redis.call('HSET', KEYS[1], 'lastRequest', now)
redis.call('PEXPIRE', KEYS[1], windowMs)
return {1, windowMs}
`

const SET_SCRIPT = `
redis.call('HSET', KEYS[1], 'count', ARGV[1], 'lastRequest', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 'OK'
`

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}

function redisBucketKey(prefix: string, key: string, hmacSecret: string): string {
  // Better Auth's key contains the client address and request path. The
  // limiter needs stable equality, not the identifying value itself.
  const digest = createHmac('sha256', hmacSecret)
    .update('repkey:better-auth-rate-limit:v1\0')
    .update(key)
    .digest('hex')
  return `${prefix}:${digest}`
}

function parseSnapshot(
  key: string,
  countRaw: string | null,
  lastRequestRaw: string | null,
): RateLimit | null {
  if (countRaw === null && lastRequestRaw === null) return null
  const count = Number(countRaw)
  const lastRequest = Number(lastRequestRaw)
  if (
    countRaw === null ||
    lastRequestRaw === null ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Number.isSafeInteger(lastRequest) ||
    lastRequest < 0
  ) {
    // Corrupt limiter state must not silently become an allow decision.
    throw new Error('[auth-rate-limit] Redis state is malformed')
  }
  return { key, count, lastRequest }
}

/**
 * Replica-safe Better Auth limiter storage backed only by the cache Redis.
 * This is deliberately not a Better Auth `secondaryStorage`: sessions and
 * verification records remain in their authoritative Postgres tables.
 */
export function createBetterAuthRateLimitStorage(
  redis: Redis,
  options: StorageOptions,
): BetterAuthRateLimitStorage {
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX
  const defaultWindowMs =
    positiveInteger(
      options.defaultWindowSeconds ?? DEFAULT_WINDOW_SECONDS,
      'defaultWindowSeconds',
    ) * 1000

  return {
    async get(key) {
      const [count, lastRequest] = await redis.hmget(
        redisBucketKey(keyPrefix, key, options.keyHmacSecret),
        'count',
        'lastRequest',
      )
      return parseSnapshot(key, count, lastRequest)
    },

    async set(key, value) {
      await redis.eval(
        SET_SCRIPT,
        1,
        redisBucketKey(keyPrefix, key, options.keyHmacSecret),
        value.count,
        value.lastRequest,
        defaultWindowMs,
      )
    },

    async consume(key, rule) {
      const windowMs = positiveInteger(rule.window, 'rate-limit window') * 1000
      const maximum = positiveInteger(rule.max, 'rate-limit maximum')
      const result = await redis.eval(
        CONSUME_SCRIPT,
        1,
        redisBucketKey(keyPrefix, key, options.keyHmacSecret),
        windowMs,
        maximum,
      )
      if (!Array.isArray(result) || result.length < 2) {
        throw new Error('[auth-rate-limit] Redis consume result is malformed')
      }
      const allowed = Number(result[0]) === 1
      const retryAfterMs = Number(result[1])
      if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
        throw new Error('[auth-rate-limit] Redis consume result is malformed')
      }
      return {
        allowed,
        retryAfter: allowed ? null : Math.max(1, Math.ceil(retryAfterMs / 1000)),
      }
    },
  }
}
