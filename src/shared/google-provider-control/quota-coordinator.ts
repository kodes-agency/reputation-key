import {
  ACQUIRE_QUOTA_SCRIPT,
  REFUND_QUOTA_SCRIPT,
  ACQUIRE_IN_FLIGHT_SCRIPT,
  RELEASE_IN_FLIGHT_SCRIPT,
} from './redis-coordination-scripts'
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
  // Reply publishing has its own lane (2026-10, reply pre-read). Every publish
  // now spends two Google calls: a `reviews.get` read of the review right before
  // the claim (on `google-reviews-v1`) and the `reviews.reply` write. On one
  // shared 30-a-minute bucket a sync scan could starve a reply, which is what
  // the reply-lifecycle incident of 2026-08-23 looked like, and a burst of 25
  // approvals would have needed 50 tokens. The write keeps the review lane's
  // size, per credential + project + endpoint, so a reply is never denied
  // because a scan or a push fetch used the minute first.
  'google-reviews-write-v1': Object.freeze({
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
  // GBP Pub/Sub notification settings (My Business Notifications API). The
  // setting is one resource per Google account, touched once per account by an
  // import item or by the daily subscription reconciliation, which reads it
  // first and writes only when it differs: a handful of calls per account per
  // day. Scoped like Reviews, per credential + project + endpoint, with a
  // project-wide ceiling because the reconciliation walks every tenant.
  // Google's published limits are 300 QPM per project for this API and 10
  // edits per minute per profile; read + write project ceilings (120 + 60)
  // stay well under the first, and the per-credential write rate equals the
  // second.
  'google-notifications-read-v1': Object.freeze({
    requestClass: 'notifications' as const,
    buckets: Object.freeze([
      bucket(
        'credential-project-endpoint-minute',
        'credential_project_endpoint',
        30,
        30,
        60_000,
      ),
      bucket('project-minute', 'project', 120, 120, 60_000),
    ]),
    inFlightScope: 'credential_project_endpoint' as const,
    maxInFlight: 2,
    leaseMs: 30_000,
    maxWaitMs: 2_000,
  }),
  'google-notifications-write-v1': Object.freeze({
    requestClass: 'notifications' as const,
    buckets: Object.freeze([
      bucket(
        'credential-project-endpoint-minute',
        'credential_project_endpoint',
        10,
        10,
        60_000,
      ),
      bucket('project-minute', 'project', 60, 60, 60_000),
    ]),
    // Two, not one: concurrent import items of one connection may each assert
    // the same desired state, and the loser should wait briefly, not fail.
    inFlightScope: 'credential_project_endpoint' as const,
    maxInFlight: 2,
    leaseMs: 30_000,
    maxWaitMs: 2_000,
  }),
} satisfies Readonly<Record<string, GoogleQuotaPolicy>>)

const FINGERPRINT = /^[a-f0-9]{64}$/
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:@/-]{1,255}$/
const LEASE_ID = /^[A-Za-z0-9_-]{16,128}$/
const MICRO_TOKENS = 1_000_000
/** How often a caller waiting for a full semaphore looks for a released slot. */
const IN_FLIGHT_POLL_MS = 100

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
  switch (scope) {
    case 'endpoint':
      return JSON.stringify(['endpoint', key.endpointClass])
    case 'project':
      return JSON.stringify(['project', key.projectFingerprint])
    case 'connection':
      return connectionId ? JSON.stringify(['connection', connectionId]) : null
    case 'user_organization_connection':
      if (!initiatorUserId || !organizationId || !connectionId) return null
      return JSON.stringify([scope, initiatorUserId, organizationId, connectionId])
    case 'user_organization_property':
      if (!initiatorUserId || !organizationId || !propertyId) return null
      return JSON.stringify([scope, initiatorUserId, organizationId, propertyId])
    case 'credential_project_endpoint':
      return JSON.stringify([
        scope,
        key.credentialFingerprint,
        key.projectFingerprint,
        key.endpointClass,
      ])
  }
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
    refund: async (key, cost) => {
      const id = fullKeyBinding(key)
      if (!id || !Number.isSafeInteger(cost) || cost < 1 || cost > deps.capacity)
        return false
      const current = buckets.get(id)
      if (!current) return true
      const nowMs = deps.nowMs()
      current.tokens = Math.min(
        deps.capacity,
        current.tokens + Math.max(0, nowMs - current.updatedAtMs) * refillPerMs + cost,
      )
      current.updatedAtMs = nowMs
      return true
    },
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

function quotaBucketArguments(
  resolved: ReadonlyArray<
    Readonly<{ policy: GoogleQuotaBucketPolicy; binding: string | null }>
  >,
  cost: number,
): Array<string | number> {
  return resolved.flatMap(({ policy, binding }) => {
    const capacity = policy.capacity * MICRO_TOKENS
    const refillPerMs = (policy.refillTokens * MICRO_TOKENS) / policy.refillIntervalMs
    const ttlMs = Math.min(
      24 * 60 * 60_000,
      Math.max(60_000, Math.ceil(capacity / refillPerMs) * 2),
    )
    return [binding as string, capacity, refillPerMs, ttlMs, cost * MICRO_TOKENS]
  })
}

/** Quota and semaphore scripts share the same collision/refusal/success reply. */
type CoordinationReply =
  | Readonly<{ ok: true; outcome: 0 | 1; advice: number }>
  | Readonly<{
      ok: false
      code: 'coordination_unavailable' | 'key_collision'
      retryAfterMs: 0
    }>

function coordinationReply(raw: unknown): CoordinationReply {
  const unavailable = {
    ok: false,
    code: 'coordination_unavailable',
    retryAfterMs: 0,
  } as const
  if (!Array.isArray(raw) || raw.length !== 2) return unavailable
  const outcome = Number(raw[0])
  const advice = Number(raw[1])
  if (!Number.isFinite(advice) || advice < 0) return unavailable
  if (outcome === -2) return { ok: false, code: 'key_collision', retryAfterMs: 0 }
  if (outcome !== 0 && outcome !== 1) return unavailable
  return { ok: true, outcome, advice }
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
    refund: async (key, cost) => {
      const resolved = deps.policy.buckets.map((policy) => ({
        policy,
        binding: scopeBinding(key, policy.scope),
      }))
      if (
        resolved.some((entry) => entry.binding === null) ||
        !Number.isSafeInteger(cost) ||
        cost < 1 ||
        deps.policy.buckets.some((entry) => cost > entry.capacity)
      )
        return false
      const keys = resolved.map((entry) =>
        coordinationKey('quota', deps.policyId, entry.policy.id, entry.binding as string),
      )
      const bucketArguments = quotaBucketArguments(resolved, cost)
      try {
        return (
          (await deps.redis.eval(
            REFUND_QUOTA_SCRIPT,
            keys.length,
            ...keys,
            deps.nowMs(),
            ...bucketArguments,
          )) === 1
        )
      } catch {
        return false
      }
    },
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
      const bucketArguments = quotaBucketArguments(resolved, cost)
      try {
        const raw = await deps.redis.eval(
          ACQUIRE_QUOTA_SCRIPT,
          keys.length,
          ...keys,
          nowMs,
          cost * MICRO_TOKENS,
          ...bucketArguments,
        )
        const reply = coordinationReply(raw)
        if (!reply.ok) return reply
        const { outcome, advice } = reply
        if (outcome === 1) {
          return {
            ok: true,
            remaining: Math.max(0, Math.floor(advice / MICRO_TOKENS)),
          }
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

export type GoogleCoordinationLookup = Readonly<{
  quotaForPolicy: (policyId: string) => GoogleQuotaCoordinator | null
  inFlightForPolicy: (policyId: string) => GoogleInFlightCoordinator | null
}>

/**
 * One quota and one in-flight coordinator per GOOGLE_QUOTA_POLICIES entry, the
 * only place the admission service finds them. A route whose policy id is not
 * in that table resolves to null here and is refused `coordination_unavailable`
 * before any request leaves: that is how every GBP notification call failed
 * until 2026-09-29 (quota-policy-coverage.test.ts).
 */
export function createGoogleCoordinationLookup(
  deps: Readonly<{
    redis: GoogleCoordinationRedis
    nowMs: () => number
    leaseId: () => string
  }>,
): GoogleCoordinationLookup {
  const quota = new Map<string, GoogleQuotaCoordinator>()
  const inFlight = new Map<string, GoogleInFlightCoordinator>()
  for (const [policyId, policy] of Object.entries(GOOGLE_QUOTA_POLICIES)) {
    quota.set(
      policyId,
      createRedisGoogleQuotaCoordinator({
        redis: deps.redis,
        nowMs: deps.nowMs,
        policyId,
        policy,
      }),
    )
    inFlight.set(
      policyId,
      createRedisGoogleInFlightCoordinator({
        redis: deps.redis,
        nowMs: deps.nowMs,
        leaseId: deps.leaseId,
        policyId,
        policy,
      }),
    )
  }
  return Object.freeze({
    quotaForPolicy: (policyId) => quota.get(policyId) ?? null,
    inFlightForPolicy: (policyId) => inFlight.get(policyId) ?? null,
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
  async function acquireLease(
    base: string,
    binding: string,
    nowMs: number,
    nextLeaseId: string,
  ): Promise<GoogleInFlightResult> {
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
      const reply = coordinationReply(raw)
      if (!reply.ok) return reply
      const { outcome, advice } = reply
      if (outcome === 1) {
        return {
          ok: true,
          lease: Object.freeze({ leaseId: nextLeaseId, expiresAtMs: advice }),
        }
      }
      return {
        ok: false,
        code: 'limit_exhausted',
        retryAfterMs: Math.max(1, Math.ceil(advice)),
      }
    } catch {
      return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
    }
  }
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
        const result = await acquireLease(base, binding, nowMs, nextLeaseId)
        if (result.ok || result.code !== 'limit_exhausted') return result
        // The advice is when the oldest lease LAPSES, an upper bound on the wait
        // (20-30 seconds in production). A call that finishes releases its slot
        // long before that, so the caller polls for a release within its wait
        // budget instead of comparing the lease's lifetime with the budget, and
        // gives up with the advice once the budget is spent.
        const retryAfterMs = result.retryAfterMs
        const remainingWaitMs = Math.min(
          deps.policy.maxWaitMs - waitedMs,
          deadlineMs - nowMs,
        )
        if (remainingWaitMs <= 0) {
          return {
            ok: false,
            code: deadlineMs - nowMs <= 0 ? 'deadline_exceeded' : 'limit_exhausted',
            retryAfterMs,
          }
        }
        const delayMs = Math.min(retryAfterMs, remainingWaitMs, IN_FLIGHT_POLL_MS)
        try {
          await sleep(delayMs)
        } catch {
          return { ok: false, code: 'coordination_unavailable', retryAfterMs: 0 }
        }
        waitedMs += delayMs
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
