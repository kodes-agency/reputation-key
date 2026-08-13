export type RefreshSingleFlight = Readonly<{
  run: <T>(connectionId: string, refresh: () => Promise<T>) => Promise<T>
  forget: (connectionId: string) => void
}>

/**
 * Process-local implementation of the refresh coalescing port. A distributed
 * adapter uses the same connection key with a fenced Redis/DB lock.
 */
export function createRefreshSingleFlight(): RefreshSingleFlight {
  const flights = new Map<string, Promise<unknown>>()
  return Object.freeze({
    run: async <T>(connectionId: string, refresh: () => Promise<T>): Promise<T> => {
      if (connectionId.length === 0) throw new Error('refresh connection key is empty')
      const existing = flights.get(connectionId)
      if (existing) return existing as Promise<T>
      const flight = Promise.resolve().then(refresh)
      flights.set(connectionId, flight)
      try {
        return await flight
      } finally {
        if (flights.get(connectionId) === flight) flights.delete(connectionId)
      }
    },
    forget: (connectionId) => {
      flights.delete(connectionId)
    },
  })
}

export type RefreshCoordinationRedis = Readonly<{
  set(
    key: string,
    value: string,
    expiryMode: 'PX',
    expiryMs: number,
    condition: 'NX',
  ): Promise<'OK' | null>
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>
}>

export type DistributedRefreshSingleFlight = Readonly<{
  run<T>(
    input: Readonly<{
      connectionFingerprint: string
      deadlineMs: number
      loadLatest: () => Promise<T | null>
      refresh: () => Promise<T>
    }>,
  ): Promise<T>
}>

export type GoogleRefreshBackoffResult =
  | Readonly<{ ok: true; consecutiveFailures: number }>
  | Readonly<{
      ok: false
      code: 'backoff_active' | 'coordination_unavailable' | 'key_collision'
      retryAfterMs: number
    }>

export type GoogleRefreshBackoffCoordinator = Readonly<{
  check(connectionFingerprint: string): Promise<GoogleRefreshBackoffResult>
  fail(
    connectionFingerprint: string,
    retryAfterMs: number | null,
  ): Promise<GoogleRefreshBackoffResult>
  succeed(connectionFingerprint: string): Promise<boolean>
}>

const REFRESH_FINGERPRINT = /^[a-f0-9]{64}$/
const REFRESH_OWNER = /^[A-Za-z0-9_-]{16,128}$/
const RELEASE_REFRESH_LOCK_SCRIPT = `-- google-refresh-lock-release-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`

export function createRedisDistributedRefreshSingleFlight(
  deps: Readonly<{
    redis: RefreshCoordinationRedis
    nowMs: () => number
    sleep: (durationMs: number) => Promise<void>
    ownerId: () => string
    leaseMs?: number
    pollMs?: number
  }>,
): DistributedRefreshSingleFlight {
  const leaseMs = deps.leaseMs ?? 20_000
  const pollMs = deps.pollMs ?? 50
  if (
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 1_000 ||
    leaseMs > 30_000 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 10 ||
    pollMs > 1_000
  ) {
    throw new Error('refresh coordination configuration is invalid')
  }
  return Object.freeze({
    run: async <T>(
      input: Readonly<{
        connectionFingerprint: string
        deadlineMs: number
        loadLatest: () => Promise<T | null>
        refresh: () => Promise<T>
      }>,
    ): Promise<T> => {
      if (
        !REFRESH_FINGERPRINT.test(input.connectionFingerprint) ||
        !Number.isSafeInteger(input.deadlineMs)
      ) {
        throw new Error('refresh coordination request is invalid')
      }
      const key = `google-provider:{${input.connectionFingerprint}}:refresh-lock`
      while (deps.nowMs() < input.deadlineMs) {
        const latest = await input.loadLatest()
        if (latest !== null) return latest
        const owner = deps.ownerId()
        if (!REFRESH_OWNER.test(owner)) {
          throw new Error('refresh coordination owner is invalid')
        }
        let acquired: 'OK' | null
        try {
          acquired = await deps.redis.set(key, owner, 'PX', leaseMs, 'NX')
        } catch {
          throw new Error('refresh coordination unavailable')
        }
        if (acquired === 'OK') {
          try {
            const committed = await input.loadLatest()
            if (committed !== null) return committed
            return await input.refresh()
          } finally {
            try {
              await deps.redis.eval(RELEASE_REFRESH_LOCK_SCRIPT, 1, key, owner)
            } catch {
              // Lease expiry remains the fail-closed release authority.
            }
          }
        }
        const remainingMs = input.deadlineMs - deps.nowMs()
        if (remainingMs > 0) await deps.sleep(Math.min(pollMs, remainingMs))
      }
      throw new Error('refresh coordination deadline exceeded')
    },
  })
}

const CHECK_REFRESH_BACKOFF_SCRIPT = `-- google-refresh-backoff-check-v1
local binding = redis.call('HGET', KEYS[1], 'binding')
if binding and binding ~= ARGV[1] then return {-2, 0, 0} end
local nowMs = tonumber(ARGV[2])
local nextAllowedAtMs = tonumber(redis.call('HGET', KEYS[1], 'nextAllowedAtMs')) or 0
local failures = tonumber(redis.call('HGET', KEYS[1], 'failures')) or 0
if nextAllowedAtMs > nowMs then
  return {0, nextAllowedAtMs - nowMs, failures}
end
return {1, 0, failures}
`

const FAIL_REFRESH_BACKOFF_SCRIPT = `-- google-refresh-backoff-fail-v1
local binding = redis.call('HGET', KEYS[1], 'binding')
if binding and binding ~= ARGV[1] then return {-2, 0, 0} end
local nowMs = tonumber(ARGV[2])
local sample = tonumber(ARGV[3])
local retryAfterMs = tonumber(ARGV[4])
local failures = math.min(31, (tonumber(redis.call('HGET', KEYS[1], 'failures')) or 0) + 1)
local capMs = math.min(300000, 5000 * (2 ^ (failures - 1)))
local jitterMs = 1 + (sample % capMs)
local delayMs = math.max(5000, jitterMs, retryAfterMs)
local nextAllowedAtMs = nowMs + delayMs
redis.call(
  'HSET',
  'binding', ARGV[1],
  'failures', failures,
  'nextAllowedAtMs', nextAllowedAtMs
)
redis.call('PEXPIRE', KEYS[1], math.max(1800000, delayMs * 2))
return {1, delayMs, failures}
`

const CLEAR_REFRESH_BACKOFF_SCRIPT = `-- google-refresh-backoff-clear-v1
local binding = redis.call('HGET', KEYS[1], 'binding')
if not binding then return 1 end
if binding ~= ARGV[1] then return -2 end
redis.call('DEL', KEYS[1])
return 1
`

function refreshBackoffKey(connectionFingerprint: string): string {
  return `google-provider:{refresh-control}:backoff:${connectionFingerprint}`
}

export function createRedisGoogleRefreshBackoffCoordinator(
  deps: Readonly<{
    redis: Pick<RefreshCoordinationRedis, 'eval'>
    nowMs: () => number
    jitterSample: () => number
  }>,
): GoogleRefreshBackoffCoordinator {
  const validateFingerprint = (value: string) => REFRESH_FINGERPRINT.test(value)
  const unavailable = (): GoogleRefreshBackoffResult => ({
    ok: false,
    code: 'coordination_unavailable',
    retryAfterMs: 0,
  })
  return Object.freeze({
    check: async (connectionFingerprint) => {
      if (!validateFingerprint(connectionFingerprint)) return unavailable()
      try {
        const raw = await deps.redis.eval(
          CHECK_REFRESH_BACKOFF_SCRIPT,
          1,
          refreshBackoffKey(connectionFingerprint),
          connectionFingerprint,
          deps.nowMs(),
        )
        if (!Array.isArray(raw) || raw.length !== 3) return unavailable()
        const outcome = Number(raw[0])
        const retryAfterMs = Number(raw[1])
        const consecutiveFailures = Number(raw[2])
        if (
          !Number.isSafeInteger(retryAfterMs) ||
          retryAfterMs < 0 ||
          !Number.isSafeInteger(consecutiveFailures) ||
          consecutiveFailures < 0 ||
          consecutiveFailures > 31
        ) {
          return unavailable()
        }
        if (outcome === -2) {
          return { ok: false, code: 'key_collision', retryAfterMs: 0 }
        }
        return outcome === 1
          ? { ok: true, consecutiveFailures }
          : outcome === 0
            ? { ok: false, code: 'backoff_active', retryAfterMs }
            : unavailable()
      } catch {
        return unavailable()
      }
    },
    fail: async (connectionFingerprint, retryAfterMs) => {
      const sample = deps.jitterSample()
      if (
        !validateFingerprint(connectionFingerprint) ||
        !Number.isSafeInteger(sample) ||
        sample < 0 ||
        sample > 0xffff_ffff ||
        (retryAfterMs !== null &&
          (!Number.isSafeInteger(retryAfterMs) ||
            retryAfterMs < 1_000 ||
            retryAfterMs > 300_000))
      ) {
        return unavailable()
      }
      try {
        const raw = await deps.redis.eval(
          FAIL_REFRESH_BACKOFF_SCRIPT,
          1,
          refreshBackoffKey(connectionFingerprint),
          connectionFingerprint,
          deps.nowMs(),
          sample,
          retryAfterMs ?? 0,
        )
        if (!Array.isArray(raw) || raw.length !== 3) return unavailable()
        const outcome = Number(raw[0])
        if (outcome === -2) {
          return { ok: false, code: 'key_collision', retryAfterMs: 0 }
        }
        const delayMs = Number(raw[1])
        const consecutiveFailures = Number(raw[2])
        if (
          !Number.isSafeInteger(delayMs) ||
          delayMs < 1 ||
          delayMs > 300_000 ||
          !Number.isSafeInteger(consecutiveFailures) ||
          consecutiveFailures < 1 ||
          consecutiveFailures > 31
        ) {
          return unavailable()
        }
        return outcome === 1
          ? {
              ok: false,
              code: 'backoff_active',
              retryAfterMs: delayMs,
            }
          : unavailable()
      } catch {
        return unavailable()
      }
    },
    succeed: async (connectionFingerprint) => {
      if (!validateFingerprint(connectionFingerprint)) return false
      try {
        return (
          Number(
            await deps.redis.eval(
              CLEAR_REFRESH_BACKOFF_SCRIPT,
              1,
              refreshBackoffKey(connectionFingerprint),
              connectionFingerprint,
            ),
          ) === 1
        )
      } catch {
        return false
      }
    },
  })
}
