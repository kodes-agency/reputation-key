import { describe, expect, it } from 'vitest'
import { assertProductionRedisTopology, getJobRedisUrl } from './redis-topology'

describe('Redis topology', () => {
  it('uses the dedicated queue endpoint when configured', () => {
    expect(
      getJobRedisUrl({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://cache:6379',
        QUEUE_REDIS_URL: 'redis://queue:6379',
      }),
    ).toBe('redis://queue:6379')
  })

  it('retains a single-Redis fallback only outside production', () => {
    expect(getJobRedisUrl({ NODE_ENV: 'test', REDIS_URL: 'redis://test:6379' })).toBe(
      'redis://test:6379',
    )
    expect(
      getJobRedisUrl({ NODE_ENV: 'production', REDIS_URL: 'redis://shared:6379' }),
    ).toBeUndefined()
  })

  it.each([
    [{ QUEUE_REDIS_URL: 'redis://queue:6379' }, 'cache_url_missing'],
    [{ REDIS_URL: 'redis://cache:6379' }, 'queue_url_missing'],
    [
      { REDIS_URL: 'not-a-url', QUEUE_REDIS_URL: 'redis://queue:6379' },
      'cache_url_invalid',
    ],
    [
      { REDIS_URL: 'redis://cache:6379', QUEUE_REDIS_URL: 'https://queue:6379' },
      'queue_url_invalid',
    ],
    [
      {
        REDIS_URL: 'redis://default:a@shared:6379/0',
        QUEUE_REDIS_URL: 'redis://default:b@SHARED:6379/1',
      },
      'endpoints_not_isolated',
    ],
  ])('rejects production topology drift as %s', (urls, code) => {
    expect(() =>
      assertProductionRedisTopology({ NODE_ENV: 'production', ...urls }),
    ).toThrow(`[CONFIG] Redis topology is incompatible: ${code}`)
  })

  it('accepts distinct production cache and queue resources', () => {
    expect(() =>
      assertProductionRedisTopology({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://cache-redis.railway.internal:6379',
        QUEUE_REDIS_URL: 'redis://queue-redis.railway.internal:6379',
      }),
    ).not.toThrow()
  })

  it('does not impose production resources on local development', () => {
    expect(() => assertProductionRedisTopology({ NODE_ENV: 'development' })).not.toThrow()
  })
})
