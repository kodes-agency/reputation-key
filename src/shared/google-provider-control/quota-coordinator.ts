import { createHash } from 'node:crypto'
import type {
  GoogleInFlightCoordinator,
  GoogleInFlightLease,
  GoogleInFlightResult,
  GoogleQuotaCoordinator,
  GoogleQuotaKey,
  GoogleQuotaResult,
  GoogleRequestClass,
} from './contracts'

export type GoogleCoordinationRedis = Readonly<{
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>
}>

export type GoogleQuotaScope =
  | 'endpoint'
  | 'project'
  | 'connection'
  | 'user_organization_connection'
  | 'user_organization_property'
  | 'credential_project_endpoint'

export type GoogleQuotaBucketPolicy = Readonly<{
  id: string
  scope: GoogleQuotaScope
  capacity: number
  refillTokens: number
  refillIntervalMs: number
}>

export type GoogleQuotaPolicy = Readonly<{
  requestClass: GoogleRequestClass
  buckets: readonly GoogleQuotaBucketPolicy[]
  inFlightScope: Extract<
    GoogleQuotaScope,
    'endpoint' | 'project' | 'credential_project_endpoint'
  >
  maxInFlight: number
  leaseMs: number
  maxWaitMs: number
}>

const bucket = (
  id: string,
  scope: GoogleQuotaScope,
  capacity: number,
  refillTokens: number,
  refillIntervalMs: number,
): GoogleQuotaBucketPolicy =>
  Object.freeze({ id, scope, capacity, refillTokens, refillIntervalMs })

export const GOOGLE_QUOTA_POLICIES = Object.freeze({
  'google-identity-v1': Object.freeze({
    requestClass: 'identity' as const,
    buckets: Object.freeze([
      bucket('project-second', 'project', 4, 4, 1_000),
      bucket('project-minute', 'project', 120, 120, 60_000),
    ]),
    inFlightScope: 'project' as const,
    maxInFlight: 4,
    leaseMs: 20_000,
    maxWaitMs: 2_000,
  }),
  'google-discovery-read-v1': Object.freeze({
    requestClass: 'discovery' as const,
    buckets: Object.freeze([
      bucket('endpoint-second', 'endpoint', 4, 4, 1_000),
      bucket(
        'user-organization-connection-minute',
        'user_organization_connection',
        60,
        60,
        60_000,
      ),
    ]),
    inFlightScope: 'endpoint' as const,
    maxInFlight: 8,
    leaseMs: 20_000,
    maxWaitMs: 2_000,
  }),
  'google-performance-read-v1': Object.freeze({
    requestClass: 'performance' as const,
    buckets: Object.freeze([
      bucket('endpoint-second', 'endpoint', 4, 4, 1_000),
      bucket(
        'user-organization-property-minute',
        'user_organization_property',
        30,
        30,
        60_000,
      ),
      bucket('project-minute', 'project', 240, 240, 60_000),
    ]),
    inFlightScope: 'endpoint' as const,
    maxInFlight: 8,
    leaseMs: 20_000,
    maxWaitMs: 2_000,
  }),
  'google-credential-refresh-v1': Object.freeze({
    requestClass: 'credential_refresh' as const,
    buckets: Object.freeze([
      bucket('project-second', 'project', 4, 4, 1_000),
      bucket('project-minute', 'project', 120, 120, 60_000),
      bucket('connection-fifteen-minutes', 'connection', 6, 6, 15 * 60_000),
    ]),
    inFlightScope: 'project' as const,
    maxInFlight: 4,
    leaseMs: 20_000,
    maxWaitMs: 2_000,
  }),
  'google-credential-cleanup-v1': Object.freeze({
    requestClass: 'credential_cleanup' as const,
    buckets: Object.freeze([
      bucket('project-second', 'project', 16, 8, 1_000),
      bucket('project-minute', 'project', 240, 240, 60_000),
    ]),
    inFlightScope: 'project' as const,
    maxInFlight: 8,
    leaseMs: 10_000,
    maxWaitMs: 2_000,
  }),
  'google-reviews-v1': Object.freeze({
    requestClass: 'reviews' as const,
    buckets: Object.freeze([
      bucket(
        'credential-project-endpoint-minute',
        'credential_project_endpoint',
        30,
        30,
        60_000,
      ),
    ]),
    inFlightScope: 'credential_project_endpoint' as const,
    maxInFlight: 4,
    leaseMs: 30_000,
    maxWaitMs: 2_000,
  }),
} satisfies Readonly<Record<string, GoogleQuotaPolicy>>)

const FINGERPRINT = /^[a-f0-9]{64}$/
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/
const LEASE_ID = /^[A-Za-z0-9_-]{16,128}$/
const MICRO_TOKENS = 1_000_000

export function googleQuotaCredentialFingerprint(
  credentialBinding: string,
  projectFingerprint: string,
): string | null {
  if (!FINGERPRINT.test(projectFingerprint)) return null
  if (FINGERPRINT.test(credentialBinding)) return credentialBinding
  if (credentialBinding !== 'none') return null
  return createHash('sha256')
    .update('google-provider-no-credential-v1', 'utf8')
    .update('\0', 'utf8')
    .update(projectFingerprint, 'utf8')
    .digest('hex')
}

const ACQUIRE_QUOTA_SCRIPT = `-- google-quota-v2
local nowMs = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local states = {}
local allowed = 1
local advice = 0
for index = 1, #KEYS do
  local offset = 2 + ((index - 1) * 5)
  local binding = ARGV[offset + 1]
  local capacity = tonumber(ARGV[offset + 2])
  local refillPerMs = tonumber(ARGV[offset + 3])
  local ttlMs = tonumber(ARGV[offset + 4])
  local bucketCost = tonumber(ARGV[offset + 5])
  local storedBinding = redis.call('HGET', KEYS[index], 'binding')
  if storedBinding and storedBinding ~= binding then return {-2, 0} end
  local tokens = tonumber(redis.call('HGET', KEYS[index], 'tokens')) or capacity
  local updatedAtMs = tonumber(redis.call('HGET', KEYS[index], 'updatedAtMs')) or nowMs
  if nowMs > updatedAtMs then
    tokens = math.min(capacity, tokens + ((nowMs - updatedAtMs) * refillPerMs))
  end
  if tokens < bucketCost then
    allowed = 0
    advice = math.max(advice, math.ceil((bucketCost - tokens) / refillPerMs))
  end
  states[index] = {binding, tokens, ttlMs, bucketCost}
end
local remaining = nil
for index = 1, #KEYS do
  local state = states[index]
  local tokens = state[2]
  if allowed == 1 then tokens = tokens - state[4] end
  redis.call(
    'HSET',
    KEYS[index],
    'binding', state[1],
    'tokens', tokens,
    'updatedAtMs', nowMs
  )
  redis.call('PEXPIRE', KEYS[index], state[3])
  if remaining == nil or tokens < remaining then remaining = tokens end
end
if allowed == 1 then return {1, math.floor(remaining or 0)} end
return {0, advice}
`

const ACQUIRE_IN_FLIGHT_SCRIPT = `-- google-inflight-acquire-v1
local binding = redis.call('GET', KEYS[1])
if binding and binding ~= ARGV[1] then return {-2, 0} end
local nowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local leaseMs = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', nowMs)
local count = redis.call('ZCARD', KEYS[2])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local retryAfterMs = 1
  if oldest[2] then retryAfterMs = math.max(1, tonumber(oldest[2]) - nowMs) end
  return {0, retryAfterMs}
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', leaseMs * 2)
redis.call('ZADD', KEYS[2], nowMs + leaseMs, ARGV[5])
redis.call('PEXPIRE', KEYS[2], leaseMs * 2)
return {1, nowMs + leaseMs}
`

const RELEASE_IN_FLIGHT_SCRIPT = `-- google-inflight-release-v1
local binding = redis.call('GET', KEYS[1])
if not binding then return 0 end
if binding ~= ARGV[1] then return -2 end
return redis.call('ZREM', KEYS[2], ARGV[2])
`

function validBaseKey(key: GoogleQuotaKey): boolean {
  return (
    FINGERPRINT.test(key.credentialFingerprint) &&
    FINGERPRINT.test(key.projectFingerprint)
  )
}

function requiredScopeId(value: string | null): string | null {
  return value !== null && SAFE_SCOPE_ID.test(value) ? value : null
}

function scopeBinding(key: GoogleQuotaKey, scope: GoogleQuotaScope): string | null {
  if (!validBaseKey(key)) return null
  const organizationId = requiredScopeId(key.organizationId)
  const initiatorUserId = requiredScopeId(key.initiatorUserId)
  const connectionId = requiredScopeId(key.connectionId)
  const propertyId = requiredScopeId(key.propertyId)
  const parts: readonly string[] | null =
    scope === 'endpoint'
      ? ['endpoint', key.endpointClass]
      : scope === 'project'
        ? ['project', key.projectFingerprint]
        : scope === 'connection'
          ? connectionId
            ? ['connection', connectionId]
            : null
          : scope === 'user_organization_connection'
            ? initiatorUserId && organizationId && connectionId
              ? [
                  'user_organization_connection',
                  initiatorUserId,
                  organizationId,
                  connectionId,
                ]
              : null
            : scope === 'user_organization_property'
              ? initiatorUserId && organizationId && propertyId
                ? [
                    'user_organization_property',
                    initiatorUserId,
                    organizationId,
                    propertyId,
                  ]
                : null
              : [
                  'credential_project_endpoint',
                  key.credentialFingerprint,
                  key.projectFingerprint,
                  key.endpointClass,
                ]
  return parts ? JSON.stringify(parts) : null
}

function coordinationKey(
  kind: 'quota' | 'inflight',
  policyId: string,
  bucketId: string,
  binding: string,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([policyId, bucketId, binding]))
    .digest('hex')
  return `google-provider:{coordination}:${kind}:${policyId}:${bucketId}:${digest}`
}

function validBucket(policy: GoogleQuotaBucketPolicy): boolean {
  return (
    /^[a-z0-9-]{1,128}$/.test(policy.id) &&
    Number.isSafeInteger(policy.capacity) &&
    policy.capacity >= 1 &&
    Number.isFinite(policy.refillTokens) &&
    policy.refillTokens > 0 &&
    Number.isSafeInteger(policy.refillIntervalMs) &&
    policy.refillIntervalMs >= 100 &&
    policy.refillIntervalMs <= 24 * 60 * 60_000
  )
}

function validPolicy(policyId: string, policy: GoogleQuotaPolicy): boolean {
  return (
    /^[a-z0-9-]{1,128}$/.test(policyId) &&
    policy.buckets.length >= 1 &&
    policy.buckets.length <= 8 &&
    policy.buckets.every(validBucket) &&
    new Set(policy.buckets.map((entry) => entry.id)).size === policy.buckets.length &&
    Number.isSafeInteger(policy.maxInFlight) &&
    policy.maxInFlight >= 1 &&
    Number.isSafeInteger(policy.leaseMs) &&
    policy.leaseMs >= 1_000 &&
    policy.leaseMs <= 60_000 &&
    Number.isSafeInteger(policy.maxWaitMs) &&
    policy.maxWaitMs >= 0 &&
    policy.maxWaitMs <= 2_000
  )
}

function fullKeyBinding(key: GoogleQuotaKey): string | null {
  if (!validBaseKey(key)) return null
  return JSON.stringify([
    key.credentialFingerprint,
    key.projectFingerprint,
    key.endpointClass,
    key.organizationId,
    key.initiatorUserId,
    key.connectionId,
    key.propertyId,
  ])
}

export function createInMemoryGoogleQuotaCoordinator(
  deps: Readonly<{
    nowMs: () => number
    capacity: number
    refillTokensPerSecond: number
  }>,
): GoogleQuotaCoordinator {
  if (
    !Number.isSafeInteger(deps.capacity) ||
    deps.capacity < 1 ||
    !Number.isFinite(deps.refillTokensPerSecond) ||
    deps.refillTokensPerSecond <= 0
  ) {
    throw new Error('Google quota configuration is invalid')
  }
  const buckets = new Map<string, { tokens: number; updatedAtMs: number }>()
  const refillPerMs = deps.refillTokensPerSecond / 1_000

  return Object.freeze({
    acquire: async (key, cost, deadlineMs): Promise<GoogleQuotaResult> => {
      const nowMs = deps.nowMs()
      const id = fullKeyBinding(key)
      if (
        !id ||
        !Number.isSafeInteger(cost) ||
        cost < 1 ||
        cost > deps.capacity ||
        !Number.isSafeInteger(deadlineMs)
      ) {
        return { ok: false, code: 'invalid_request', retryAfterMs: 0 }
      }
      if (deadlineMs <= nowMs) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      const current = buckets.get(id) ?? {
        tokens: deps.capacity,
        updatedAtMs: nowMs,
      }
      const elapsedMs = Math.max(0, nowMs - current.updatedAtMs)
      current.tokens = Math.min(deps.capacity, current.tokens + elapsedMs * refillPerMs)
      current.updatedAtMs = nowMs
      if (current.tokens >= cost) {
        current.tokens -= cost
        buckets.set(id, current)
        return { ok: true, remaining: Math.floor(current.tokens) }
      }
      buckets.set(id, current)
      const retryAfterMs = Math.ceil((cost - current.tokens) / refillPerMs)
      if (nowMs + retryAfterMs > deadlineMs) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs }
      }
      return { ok: false, code: 'quota_exhausted', retryAfterMs }
    },
  })
}

export function createRedisGoogleQuotaCoordinator(
  deps: Readonly<{
    redis: GoogleCoordinationRedis
    nowMs: () => number
    policyId: string
    policy: GoogleQuotaPolicy
  }>,
): GoogleQuotaCoordinator {
  if (!validPolicy(deps.policyId, deps.policy)) {
    throw new Error('Google quota configuration is invalid')
  }
  return Object.freeze({
    acquire: async (key, cost, deadlineMs): Promise<GoogleQuotaResult> => {
      const nowMs = deps.nowMs()
      const resolved = deps.policy.buckets.map((policy) => ({
        policy,
        binding: scopeBinding(key, policy.scope),
      }))
      if (
        resolved.some((entry) => entry.binding === null) ||
        !Number.isSafeInteger(cost) ||
        cost < 1 ||
        deps.policy.buckets.some((entry) => cost > entry.capacity) ||
        !Number.isSafeInteger(deadlineMs)
      ) {
        return { ok: false, code: 'invalid_request', retryAfterMs: 0 }
      }
      if (deadlineMs <= nowMs) {
        return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
      }
      const keys = resolved.map((entry) =>
        coordinationKey('quota', deps.policyId, entry.policy.id, entry.binding as string),
      )
      const bucketArguments = resolved.flatMap(({ policy, binding }) => {
        const capacity = policy.capacity * MICRO_TOKENS
        const refillPerMs = (policy.refillTokens * MICRO_TOKENS) / policy.refillIntervalMs
        const ttlMs = Math.min(
          24 * 60 * 60_000,
          Math.max(60_000, Math.ceil(capacity / refillPerMs) * 2),
        )
        return [binding as string, capacity, refillPerMs, ttlMs, cost * MICRO_TOKENS]
      })
      try {
        const raw = await deps.redis.eval(
          ACQUIRE_QUOTA_SCRIPT,
          keys.length,
          ...keys,
          nowMs,
          cost * MICRO_TOKENS,
          ...bucketArguments,
        )
        if (!Array.isArray(raw) || raw.length !== 2) {
          return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
        }
        const outcome = Number(raw[0])
        const advice = Number(raw[1])
        if (!Number.isFinite(advice) || advice < 0) {
          return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
        }
        if (outcome === -2) {
          return { ok: false, code: 'key_collision', retryAfterMs: 0 }
        }
        if (outcome === 1) {
          return {
            ok: true,
            remaining: Math.max(0, Math.floor(advice / MICRO_TOKENS)),
          }
        }
        if (outcome !== 0) {
          return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
        }
        const retryAfterMs = Math.max(1, Math.ceil(advice))
        if (nowMs + retryAfterMs > deadlineMs) {
          return { ok: false, code: 'deadline_exceeded', retryAfterMs }
        }
        return { ok: false, code: 'quota_exhausted', retryAfterMs }
      } catch {
        return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
      }
    },
  })
}

export function createRedisGoogleInFlightCoordinator(
  deps: Readonly<{
    redis: GoogleCoordinationRedis
    nowMs: () => number
    leaseId: () => string
    policyId: string
    policy: GoogleQuotaPolicy
    sleep?: (delayMs: number) => Promise<void>
  }>,
): GoogleInFlightCoordinator {
  if (!validPolicy(deps.policyId, deps.policy)) {
    throw new Error('Google in-flight configuration is invalid')
  }
  const sleep =
    deps.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs)
      }))
  return Object.freeze({
    acquire: async (key, deadlineMs): Promise<GoogleInFlightResult> => {
      const binding = scopeBinding(key, deps.policy.inFlightScope)
      if (
        !binding ||
        key.requestClass !== deps.policy.requestClass ||
        !Number.isSafeInteger(deadlineMs)
      ) {
        return { ok: false, code: 'invalid_request', retryAfterMs: 0 }
      }
      const base = coordinationKey(
        'inflight',
        deps.policyId,
        deps.policy.inFlightScope,
        binding,
      )
      let waitedMs = 0
      while (true) {
        const nowMs = deps.nowMs()
        if (deadlineMs <= nowMs) {
          return { ok: false, code: 'deadline_exceeded', retryAfterMs: 0 }
        }
        const nextLeaseId = deps.leaseId()
        if (!LEASE_ID.test(nextLeaseId)) {
          return { ok: false, code: 'invalid_request', retryAfterMs: 0 }
        }
        try {
          const raw = await deps.redis.eval(
            ACQUIRE_IN_FLIGHT_SCRIPT,
            2,
            `${base}:binding`,
            `${base}:leases`,
            binding,
            nowMs,
            deps.policy.maxInFlight,
            deps.policy.leaseMs,
            nextLeaseId,
          )
          if (!Array.isArray(raw) || raw.length !== 2) {
            return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
          }
          const outcome = Number(raw[0])
          const advice = Number(raw[1])
          if (!Number.isFinite(advice) || advice < 0) {
            return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
          }
          if (outcome === -2) {
            return { ok: false, code: 'key_collision', retryAfterMs: 0 }
          }
          if (outcome === 1) {
            return {
              ok: true,
              lease: Object.freeze({ leaseId: nextLeaseId, expiresAtMs: advice }),
            }
          }
          if (outcome !== 0) {
            return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
          }
          const retryAfterMs = Math.max(1, Math.ceil(advice))
          const remainingWaitMs = Math.min(
            deps.policy.maxWaitMs - waitedMs,
            deadlineMs - nowMs,
          )
          if (remainingWaitMs <= 0 || retryAfterMs > remainingWaitMs) {
            return {
              ok: false,
              code: deadlineMs - nowMs <= 0 ? 'deadline_exceeded' : 'limit_exhausted',
              retryAfterMs,
            }
          }
          const delayMs = Math.min(retryAfterMs, remainingWaitMs)
          await sleep(delayMs)
          waitedMs += delayMs
        } catch {
          return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
        }
      }
    },
    release: async (key, lease: GoogleInFlightLease): Promise<boolean> => {
      const binding = scopeBinding(key, deps.policy.inFlightScope)
      if (
        !binding ||
        key.requestClass !== deps.policy.requestClass ||
        !LEASE_ID.test(lease.leaseId) ||
        !Number.isSafeInteger(lease.expiresAtMs)
      ) {
        return false
      }
      const base = coordinationKey(
        'inflight',
        deps.policyId,
        deps.policy.inFlightScope,
        binding,
      )
      try {
        const raw = await deps.redis.eval(
          RELEASE_IN_FLIGHT_SCRIPT,
          2,
          `${base}:binding`,
          `${base}:leases`,
          binding,
          lease.leaseId,
        )
        return Number(raw) === 1
      } catch {
        return false
      }
    },
  })
}
