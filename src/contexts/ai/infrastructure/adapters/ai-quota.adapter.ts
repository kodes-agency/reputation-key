import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { AiQuotaPort } from '../../application/ports/ai-quota.port'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'

const LEASE_MILLIS = 45_000
const RATE_WINDOW_MILLIS = 60_000
const PROPERTY_CAPACITY: Readonly<Record<MerchantAiCapability, number>> = {
  review_analysis: 2,
  reply_drafting: 2,
  property_trends: 1,
}
const DEPLOYMENT_CAPACITY: Readonly<Record<MerchantAiCapability, number>> = {
  review_analysis: 16,
  reply_drafting: 8,
  property_trends: 4,
}
const DEPLOYMENT_RATE: Readonly<Record<MerchantAiCapability, number>> = {
  review_analysis: 60,
  reply_drafting: 30,
  property_trends: 10,
}

const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local rateStart = now - tonumber(ARGV[3])
local rateCap = tonumber(ARGV[4])
local deploymentCap = tonumber(ARGV[5])
local propertyCap = tonumber(ARGV[6])
local token = ARGV[7]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', rateStart)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
local rateCount = redis.call('ZCARD', KEYS[1])
local deploymentCount = redis.call('ZCARD', KEYS[2])
local propertyCount = redis.call('ZCARD', KEYS[3])
if rateCount >= rateCap or deploymentCount >= deploymentCap or propertyCount >= propertyCap then
  return {0, math.min(rateCap - rateCount, deploymentCap - deploymentCount, propertyCap - propertyCount)}
end
redis.call('ZADD', KEYS[1], now, token)
redis.call('ZADD', KEYS[2], expires, token)
redis.call('ZADD', KEYS[3], expires, token)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 2)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[3]) * 2)
redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[3]) * 2)
redis.call('SET', KEYS[4], '1', 'PX', expires - now)
return {1, math.min(rateCap - rateCount - 1, deploymentCap - deploymentCount - 1, propertyCap - propertyCount - 1)}
`

const RELEASE_SCRIPT = `
if redis.call('DEL', KEYS[3]) == 0 then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TOKEN =
  /^(review_analysis|reply_drafting|property_trends)\.([0-9a-f-]{36})\.([0-9a-f-]{36})$/

function prefix(capability: MerchantAiCapability): string {
  return `ai-quota:{private-beta-global-v1:${capability}}`
}

function keys(capability: MerchantAiCapability, propertyId: string, token: string) {
  const base = prefix(capability)
  return {
    rate: `${base}:rate`,
    deployment: `${base}:inflight`,
    property: `${base}:property:${propertyId}`,
    lease: `${base}:lease:${token}`,
  }
}

export function createRedisAiQuotaAdapter(redis: Redis): AiQuotaPort {
  return {
    async acquire(input) {
      if (!UUID.test(input.propertyId) || !Number.isSafeInteger(input.nowEpochMillis)) {
        return { ok: false, code: 'provider_unavailable' }
      }
      const expiresAtEpochMillis = input.nowEpochMillis + LEASE_MILLIS
      const token = `${input.capability}.${input.propertyId}.${randomUUID()}`
      const quotaKeys = keys(input.capability, input.propertyId, token)
      try {
        const raw = await redis.eval(
          ACQUIRE_SCRIPT,
          4,
          quotaKeys.rate,
          quotaKeys.deployment,
          quotaKeys.property,
          quotaKeys.lease,
          input.nowEpochMillis,
          expiresAtEpochMillis,
          RATE_WINDOW_MILLIS,
          DEPLOYMENT_RATE[input.capability],
          DEPLOYMENT_CAPACITY[input.capability],
          PROPERTY_CAPACITY[input.capability],
          token,
        )
        if (!Array.isArray(raw) || raw.length !== 2) {
          return { ok: false, code: 'provider_unavailable' }
        }
        if (Number(raw[0]) !== 1) return { ok: false, code: 'quota_exceeded' }
        const remaining = Number(raw[1])
        if (!Number.isSafeInteger(remaining) || remaining < 0) {
          return { ok: false, code: 'provider_unavailable' }
        }
        return { ok: true, quotaId: token, expiresAtEpochMillis, remaining }
      } catch {
        return { ok: false, code: 'provider_unavailable' }
      }
    },

    async release(input) {
      const match = TOKEN.exec(input.quotaId)
      if (!match || !UUID.test(match[2] ?? '') || !UUID.test(match[3] ?? '')) return
      const capability = match[1] as MerchantAiCapability
      const propertyId = match[2] as string
      const quotaKeys = keys(capability, propertyId, input.quotaId)
      try {
        await redis.eval(
          RELEASE_SCRIPT,
          3,
          quotaKeys.deployment,
          quotaKeys.property,
          quotaKeys.lease,
          input.quotaId,
        )
      } catch {
        // Lease expiry remains the fail-closed release authority.
      }
    },
  }
}
