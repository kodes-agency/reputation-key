import { describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import { assertJobRedisRuntime, verifyJobRedisRuntime } from './redis-runtime'

function redisWith(overrides: Partial<Redis> = {}): Redis {
  return {
    info: vi.fn().mockResolvedValue('# Server\r\nredis_version:7.4.2\r\n'),
    config: vi.fn().mockResolvedValue(['maxmemory-policy', 'noeviction']),
    call: vi
      .fn()
      .mockResolvedValue([
        ['getdel', 2, ['write', 'fast'], 1, 1, 1, ['@write', '@string', '@fast']],
      ]),
    ...overrides,
  } as unknown as Redis
}

describe('BullMQ Redis runtime verification', () => {
  it('accepts Redis 6.2+ with GETDEL and noeviction', async () => {
    await expect(verifyJobRedisRuntime(redisWith())).resolves.toEqual({
      ok: true,
      redisVersion: '7.4.2',
      maxmemoryPolicy: 'noeviction',
      getdelAvailable: true,
    })
  })

  it.each([
    ['version_unsupported', '# Server\r\nredis_version:6.0.20\r\n'],
    ['version_unsupported', '# Server\r\nredis_version:not-semver\r\n'],
  ])('rejects an unsupported Redis version as %s', async (code, info) => {
    await expect(
      verifyJobRedisRuntime(
        redisWith({ info: vi.fn().mockResolvedValue(info) as never }),
      ),
    ).resolves.toEqual({ ok: false, code })
  })

  it.each([null, [null], []])(
    'rejects an unavailable GETDEL command response %#',
    async (response) => {
      await expect(
        verifyJobRedisRuntime(
          redisWith({ call: vi.fn().mockResolvedValue(response) as never }),
        ),
      ).resolves.toEqual({ ok: false, code: 'getdel_unavailable' })
    },
  )

  it.each([['allkeys-lru'], ['volatile-ttl'], ['maxmemory-policy', 'allkeys-lru']])(
    'rejects eviction-capable policy response %#',
    async (...config) => {
      await expect(
        verifyJobRedisRuntime(
          redisWith({ config: vi.fn().mockResolvedValue(config) as never }),
        ),
      ).resolves.toEqual({ ok: false, code: 'maxmemory_policy_invalid' })
    },
  )

  it('fails closed when inspection is unavailable without exposing the cause', async () => {
    const redis = redisWith({
      info: vi.fn().mockRejectedValue(new Error('redis://user:secret@example.invalid')),
    })

    await expect(verifyJobRedisRuntime(redis)).resolves.toEqual({
      ok: false,
      code: 'inspection_unavailable',
    })
    await expect(assertJobRedisRuntime(redis)).rejects.toThrow(
      '[CONFIG] BullMQ Redis runtime is incompatible: inspection_unavailable',
    )
    await expect(assertJobRedisRuntime(redis)).rejects.not.toThrow('secret')
  })
})
