import type { Redis } from 'ioredis'
import type { AiAdmissionPort } from '../../application/ports/ai-admission.port'
import {
  AI_ADMISSION_IN_FLIGHT,
  AI_ADMISSION_LEASE_MILLIS,
  AI_ADMISSION_RATE_PER_MINUTE,
  AI_ADMISSION_RATE_WINDOW_MILLIS,
  isAiAdmissionLane,
  type AiAdmissionLane,
} from '../../domain/admission-lanes'

/**
 * Admit only when every scope of the lane has room, then record the admission
 * in every scope in the same call. A denial writes nothing: it only prunes
 * members that have already aged out, which changes no count a later caller
 * could observe differently. Rate sets are scored by admission time (a sliding
 * minute); in-flight sets are scored by lease expiry.
 *
 * KEYS: rate global, rate organization, rate property, in-flight global,
 *       in-flight organization, in-flight property, lease.
 * ARGV: now, lease expiry, window, three rate caps, three in-flight caps,
 *       token, headroom.
 */
const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local token = ARGV[10]
local headroom = tonumber(ARGV[11])
local retryAt = 0
local denied = false
for i = 1, 3 do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)
  local allowed = tonumber(ARGV[3 + i]) - headroom
  local count = redis.call('ZCARD', KEYS[i])
  if allowed < 1 or count >= allowed then
    denied = true
    local freeAt = now + window
    if allowed >= 1 then
      local freeing = redis.call('ZRANGE', KEYS[i], count - allowed, count - allowed, 'WITHSCORES')
      if freeing[2] then freeAt = tonumber(freeing[2]) + window end
    end
    if freeAt > retryAt then retryAt = freeAt end
  end
end
for i = 4, 6 do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
  local count = redis.call('ZCARD', KEYS[i])
  if count >= tonumber(ARGV[3 + i]) then
    denied = true
    local freeAt = now + 1000
    local earliest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    if earliest[2] then freeAt = math.min(tonumber(earliest[2]), now + 5000) end
    if freeAt > retryAt then retryAt = freeAt end
  end
end
if denied then
  return {0, retryAt}
end
for i = 1, 3 do
  redis.call('ZADD', KEYS[i], now, token)
  redis.call('PEXPIRE', KEYS[i], window * 2)
end
for i = 4, 6 do
  redis.call('ZADD', KEYS[i], expires, token)
  redis.call('PEXPIRE', KEYS[i], (expires - now) + window)
end
redis.call('SET', KEYS[7], '1', 'PX', expires - now)
return {1, expires}
`

/**
 * Free the in-flight slot once. A lease that already expired has had its
 * members pruned by expiry score, so a late release changes nothing.
 * KEYS: in-flight global, in-flight organization, in-flight property, lease.
 */
const RELEASE_SCRIPT = `
if redis.call('DEL', KEYS[4]) == 0 then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
return 1
`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ORGANIZATION_ID = /^[A-Za-z0-9_.:-]{1,255}$/
const NAMESPACE = /^[a-z0-9][a-z0-9-]{0,63}$/
const TOKEN =
  /^a1\.(interactive|background)\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{1,400})\.([0-9a-f-]{36})$/
const DEFAULT_NAMESPACE = 'private-beta-global-v1'

type AdmissionKeys = Readonly<{
  rate: readonly [string, string, string]
  inFlight: readonly [string, string, string]
  lease: string
}>

function encodeOrganization(organizationId: string): string {
  return Buffer.from(organizationId, 'utf8').toString('base64url')
}

function admissionKeys(
  namespace: string,
  lane: AiAdmissionLane,
  organizationId: string,
  propertyId: string,
  token: string,
): AdmissionKeys {
  // One hash tag keeps every key of an admission in the same cluster slot.
  const base = `ai-admission:{${namespace}}`
  const organization = encodeOrganization(organizationId)
  return {
    rate: [
      `${base}:rate:global:${lane}`,
      `${base}:rate:organization:${organization}:${lane}`,
      `${base}:rate:property:${propertyId}:${lane}`,
    ],
    inFlight: [
      `${base}:in-flight:global:${lane}`,
      `${base}:in-flight:organization:${organization}:${lane}`,
      `${base}:in-flight:property:${propertyId}:${lane}`,
    ],
    lease: `${base}:lease:${token}`,
  }
}

function minimumRateCap(lane: AiAdmissionLane): number {
  return Math.min(
    AI_ADMISSION_RATE_PER_MINUTE.global[lane],
    AI_ADMISSION_RATE_PER_MINUTE.organization[lane],
    AI_ADMISSION_RATE_PER_MINUTE.property[lane],
  )
}

export type RedisAiLaneAdmissionOptions = Readonly<{
  /** Key namespace; tests use a unique one so shared Redis state cannot leak in. */
  namespace?: string
}>

export const createRedisAiLaneAdmissionAdapter = (
  redis: Redis,
  idGen: () => string,
  options: RedisAiLaneAdmissionOptions = {},
): AiAdmissionPort => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE
  if (!NAMESPACE.test(namespace)) {
    throw new Error('AI admission namespace is invalid')
  }

  return Object.freeze({
    async acquire(input) {
      const headroom = input.headroom ?? 0
      if (
        !isAiAdmissionLane(input.lane) ||
        !UUID.test(input.propertyId) ||
        !ORGANIZATION_ID.test(input.organizationId) ||
        !Number.isSafeInteger(input.nowEpochMillis) ||
        input.nowEpochMillis < 0 ||
        !Number.isSafeInteger(headroom) ||
        headroom < 0 ||
        headroom >= minimumRateCap(input.lane)
      ) {
        return { ok: false, code: 'admission_unavailable' }
      }
      const id = idGen()
      if (!UUID.test(id)) return { ok: false, code: 'admission_unavailable' }
      const lane = input.lane
      const token = `a1.${lane}.${input.propertyId}.${encodeOrganization(input.organizationId)}.${id}`
      const keys = admissionKeys(
        namespace,
        lane,
        input.organizationId,
        input.propertyId,
        token,
      )
      const expiresAtEpochMillis = input.nowEpochMillis + AI_ADMISSION_LEASE_MILLIS
      try {
        const raw = await redis.eval(
          ACQUIRE_SCRIPT,
          7,
          ...keys.rate,
          ...keys.inFlight,
          keys.lease,
          input.nowEpochMillis,
          expiresAtEpochMillis,
          AI_ADMISSION_RATE_WINDOW_MILLIS,
          AI_ADMISSION_RATE_PER_MINUTE.global[lane],
          AI_ADMISSION_RATE_PER_MINUTE.organization[lane],
          AI_ADMISSION_RATE_PER_MINUTE.property[lane],
          AI_ADMISSION_IN_FLIGHT.global[lane],
          AI_ADMISSION_IN_FLIGHT.organization[lane],
          AI_ADMISSION_IN_FLIGHT.property[lane],
          token,
          headroom,
        )
        if (!Array.isArray(raw) || raw.length !== 2) {
          return { ok: false, code: 'admission_unavailable' }
        }
        const instant = Number(raw[1])
        if (!Number.isSafeInteger(instant) || instant < input.nowEpochMillis) {
          return { ok: false, code: 'admission_unavailable' }
        }
        if (Number(raw[0]) !== 1) {
          return { ok: false, code: 'admission_busy', retryAfterEpochMillis: instant }
        }
        return { ok: true, admissionId: token, expiresAtEpochMillis }
      } catch {
        return { ok: false, code: 'admission_unavailable' }
      }
    },

    async release(input) {
      const match = TOKEN.exec(input.admissionId)
      if (!match) return
      const [, lane, propertyId, encodedOrganization, id] = match
      if (!UUID.test(propertyId ?? '') || !UUID.test(id ?? '')) return
      const organizationId = Buffer.from(encodedOrganization ?? '', 'base64url').toString(
        'utf8',
      )
      if (!ORGANIZATION_ID.test(organizationId)) return
      const keys = admissionKeys(
        namespace,
        lane as AiAdmissionLane,
        organizationId,
        propertyId as string,
        input.admissionId,
      )
      try {
        await redis.eval(
          RELEASE_SCRIPT,
          4,
          ...keys.inFlight,
          keys.lease,
          input.admissionId,
        )
      } catch {
        // Lease expiry remains the fail-closed release authority.
      }
    },
  })
}
