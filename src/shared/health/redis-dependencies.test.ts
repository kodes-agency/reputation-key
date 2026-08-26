import { beforeEach, describe, expect, it, vi } from 'vitest'

const cacheHealthy = vi.hoisted(() => vi.fn())
const queueHealthy = vi.hoisted(() => vi.fn())

vi.mock('#/shared/cache/redis', () => ({ isRedisHealthy: cacheHealthy }))
vi.mock('#/shared/jobs/redis-runtime', () => ({ isJobRedisHealthy: queueHealthy }))

import { areRedisDependenciesHealthy } from './redis-dependencies'

describe('Redis dependency health', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    [true, true, true],
    [false, true, false],
    [true, false, false],
    [false, false, false],
  ])('combines cache=%s and queue=%s as %s', async (cache, queue, expected) => {
    cacheHealthy.mockResolvedValue(cache)
    queueHealthy.mockResolvedValue(queue)

    await expect(areRedisDependenciesHealthy()).resolves.toBe(expected)
    expect(cacheHealthy).toHaveBeenCalledOnce()
    expect(queueHealthy).toHaveBeenCalledOnce()
  })
})
