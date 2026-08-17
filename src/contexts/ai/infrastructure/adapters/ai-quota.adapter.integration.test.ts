import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Redis from 'ioredis'
import { propertyId } from '#/shared/domain/ids'
import { createRedisAiQuotaAdapter } from './ai-quota.adapter'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const PROPERTY_ID = propertyId('72000000-0000-4000-8000-000000000001')
const PREFIX = 'ai-quota:{private-beta-global-v1:review_analysis}'

describe('AI quota adapter (real Redis)', () => {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  const quota = createRedisAiQuotaAdapter(redis)

  beforeAll(async () => {
    await redis.connect()
    await redis.del(
      `${PREFIX}:rate`,
      `${PREFIX}:inflight`,
      `${PREFIX}:property:${PROPERTY_ID}`,
    )
  })

  afterAll(async () => {
    await redis.del(
      `${PREFIX}:rate`,
      `${PREFIX}:inflight`,
      `${PREFIX}:property:${PROPERTY_ID}`,
    )
    await redis.quit()
  })

  it('atomically enforces the per-property lease cap and idempotent release', async () => {
    const nowEpochMillis = Date.parse('2026-08-16T12:00:00.000Z')
    const [first, second] = await Promise.all([
      quota.acquire({
        propertyId: PROPERTY_ID,
        capability: 'review_analysis',
        nowEpochMillis,
      }),
      quota.acquire({
        propertyId: PROPERTY_ID,
        capability: 'review_analysis',
        nowEpochMillis,
      }),
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)

    await expect(
      quota.acquire({
        propertyId: PROPERTY_ID,
        capability: 'review_analysis',
        nowEpochMillis,
      }),
    ).resolves.toEqual({ ok: false, code: 'quota_exceeded' })

    if (!first.ok) return
    await quota.release({ quotaId: first.quotaId })
    await quota.release({ quotaId: first.quotaId })
    await expect(
      quota.acquire({
        propertyId: PROPERTY_ID,
        capability: 'review_analysis',
        nowEpochMillis,
      }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('expires stale in-flight members using the supplied admission clock', async () => {
    await redis.del(
      `${PREFIX}:rate`,
      `${PREFIX}:inflight`,
      `${PREFIX}:property:${PROPERTY_ID}`,
    )
    const nowEpochMillis = Date.parse('2026-08-16T13:00:00.000Z')
    await quota.acquire({
      propertyId: PROPERTY_ID,
      capability: 'review_analysis',
      nowEpochMillis,
    })
    await quota.acquire({
      propertyId: PROPERTY_ID,
      capability: 'review_analysis',
      nowEpochMillis,
    })

    await expect(
      quota.acquire({
        propertyId: PROPERTY_ID,
        capability: 'review_analysis',
        nowEpochMillis: nowEpochMillis + 45_000,
      }),
    ).resolves.toMatchObject({ ok: true })
  })
})
