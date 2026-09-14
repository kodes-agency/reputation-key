import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  AI_ADMISSION_IN_FLIGHT,
  AI_ADMISSION_RATE_PER_MINUTE,
  AI_ADMISSION_RATE_WINDOW_MILLIS,
} from '../../domain/admission-lanes'
import { createRedisAiLaneAdmissionAdapter } from './ai-lane-admission.adapter'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'
const NOW = Date.parse('2026-09-15T12:00:00.000Z')

describe('AI lane admission adapter (real Redis)', () => {
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  const namespace = `test-${randomUUID().slice(0, 8)}`
  const admission = createRedisAiLaneAdmissionAdapter(redis, randomUUID, { namespace })
  const base = `ai-admission:{${namespace}}`
  let organization = organizationId(`org-${randomUUID()}`)
  let property = propertyId(randomUUID())

  const acquire = (
    lane: 'interactive' | 'background',
    nowEpochMillis = NOW,
    overrides: Partial<{ property: typeof property; headroom: number }> = {},
  ) =>
    admission.acquire({
      organizationId: organization,
      propertyId: overrides.property ?? property,
      lane,
      nowEpochMillis,
      ...(overrides.headroom === undefined ? {} : { headroom: overrides.headroom }),
    })

  const clearNamespace = async () => {
    const keys = await redis.keys(`${base}:*`)
    if (keys.length > 0) await redis.del(...keys)
  }

  beforeAll(async () => {
    await redis.connect()
  })

  beforeEach(async () => {
    await clearNamespace()
    organization = organizationId(`org-${randomUUID()}`)
    property = propertyId(randomUUID())
  })

  afterAll(async () => {
    await clearNamespace()
    await redis.quit()
  })

  it('admits up to the property rate, then answers busy without consuming any scope', async () => {
    const cap = AI_ADMISSION_RATE_PER_MINUTE.property.interactive
    for (let index = 0; index < cap; index += 1) {
      const claim = await acquire('interactive', NOW + index)
      expect(claim.ok).toBe(true)
      if (claim.ok) await admission.release({ admissionId: claim.admissionId })
    }
    const globalBefore = await redis.zcard(`${base}:rate:global:interactive`)

    const denied = await acquire('interactive', NOW + 10)

    expect(denied).toEqual({
      ok: false,
      code: 'admission_busy',
      retryAfterEpochMillis: NOW + AI_ADMISSION_RATE_WINDOW_MILLIS,
    })
    expect(await redis.zcard(`${base}:rate:global:interactive`)).toBe(globalBefore)
    const organizationKeys = await redis.keys(`${base}:rate:organization:*:interactive`)
    expect(organizationKeys).toHaveLength(1)
    expect(await redis.zcard(organizationKeys[0] as string)).toBe(cap)
  })

  it('keeps the interactive lane open while the background lane is saturated', async () => {
    const backgroundCap = Math.min(
      AI_ADMISSION_RATE_PER_MINUTE.property.background,
      AI_ADMISSION_IN_FLIGHT.property.background,
    )
    for (let index = 0; index < backgroundCap; index += 1) {
      expect((await acquire('background', NOW + index)).ok).toBe(true)
    }
    expect((await acquire('background', NOW + 5)).ok).toBe(false)

    await expect(acquire('interactive', NOW + 6)).resolves.toMatchObject({ ok: true })
  })

  it('frees an in-flight slot once on release', async () => {
    const cap = AI_ADMISSION_IN_FLIGHT.property.interactive
    const claims = []
    for (let index = 0; index < cap; index += 1) {
      const claim = await acquire('interactive', NOW + index)
      expect(claim.ok).toBe(true)
      claims.push(claim)
    }
    const blocked = await acquire('interactive', NOW + 10)
    expect(blocked).toMatchObject({ ok: false, code: 'admission_busy' })

    const first = claims[0]
    if (!first?.ok) throw new Error('expected an admission')
    await admission.release({ admissionId: first.admissionId })
    await admission.release({ admissionId: first.admissionId })

    await expect(acquire('interactive', NOW + 11)).resolves.toMatchObject({ ok: true })
    await expect(acquire('interactive', NOW + 12)).resolves.toMatchObject({
      ok: false,
      code: 'admission_busy',
    })
  })

  it('counts admissions over a sliding minute', async () => {
    const cap = AI_ADMISSION_RATE_PER_MINUTE.property.background
    for (let index = 0; index < cap; index += 1) {
      const claim = await acquire('background', NOW + index * 1_000)
      if (claim.ok) await admission.release({ admissionId: claim.admissionId })
    }
    expect((await acquire('background', NOW + 30_000)).ok).toBe(false)

    await expect(
      acquire('background', NOW + AI_ADMISSION_RATE_WINDOW_MILLIS + 1),
    ).resolves.toMatchObject({ ok: true })
  })

  it('leaves the requested headroom free in the lane', async () => {
    const cap = AI_ADMISSION_RATE_PER_MINUTE.property.interactive
    let admitted = 0
    for (let index = 0; index < cap; index += 1) {
      const claim = await acquire('interactive', NOW + index, { headroom: 1 })
      if (claim.ok) {
        admitted += 1
        await admission.release({ admissionId: claim.admissionId })
      }
    }

    expect(admitted).toBe(cap - 1)
    await expect(acquire('interactive', NOW + 10)).resolves.toMatchObject({ ok: true })
  })

  it('expires an unreleased in-flight slot with the supplied clock', async () => {
    for (let index = 0; index < AI_ADMISSION_IN_FLIGHT.property.background; index += 1) {
      await acquire('background', NOW + index)
    }
    expect((await acquire('background', NOW + 10)).ok).toBe(false)

    await expect(
      acquire('background', NOW + AI_ADMISSION_RATE_WINDOW_MILLIS * 2),
    ).resolves.toMatchObject({ ok: true })
  })

  it('fails closed on malformed input without touching Redis', async () => {
    await expect(
      admission.acquire({
        organizationId: organization,
        propertyId: propertyId('not-a-uuid'),
        lane: 'interactive',
        nowEpochMillis: NOW,
      }),
    ).resolves.toEqual({ ok: false, code: 'admission_unavailable' })
    await expect(
      acquire('interactive', NOW, {
        headroom: AI_ADMISSION_RATE_PER_MINUTE.property.interactive,
      }),
    ).resolves.toEqual({ ok: false, code: 'admission_unavailable' })
    expect(await redis.keys(`${base}:*`)).toHaveLength(0)
  })

  it('isolates properties in the same organization at the property scope', async () => {
    const other = propertyId(randomUUID())
    for (let index = 0; index < AI_ADMISSION_IN_FLIGHT.property.interactive; index += 1) {
      await acquire('interactive', NOW + index)
    }
    expect((await acquire('interactive', NOW + 10)).ok).toBe(false)

    await expect(
      acquire('interactive', NOW + 11, { property: other }),
    ).resolves.toMatchObject({ ok: true })
  })
})
