import { describe, expect, it, beforeEach } from 'vitest'
import {
  getTenantCacheStats,
  recordTenantCacheEviction,
  recordTenantCacheHit,
  recordTenantCacheMiss,
  registerTenantCacheSizeReader,
  resetTenantCacheStats,
} from './tenant-cache-stats'

describe('tenant-cache-stats', () => {
  beforeEach(() => {
    resetTenantCacheStats()
    registerTenantCacheSizeReader(() => 0)
  })

  it('counts hits, misses, and evictions as monotonic totals', () => {
    recordTenantCacheHit()
    recordTenantCacheHit()
    recordTenantCacheMiss()
    recordTenantCacheEviction()
    expect(getTenantCacheStats()).toEqual({ hits: 2, misses: 1, evictions: 1, size: 0 })
  })

  it('reads size through the registered reader', () => {
    registerTenantCacheSizeReader(() => 42)
    expect(getTenantCacheStats().size).toBe(42)
  })

  it('resets counters but keeps the size reader', () => {
    recordTenantCacheHit()
    registerTenantCacheSizeReader(() => 7)
    resetTenantCacheStats()
    expect(getTenantCacheStats()).toEqual({ hits: 0, misses: 0, evictions: 0, size: 7 })
  })

  it('defaults size to zero when no reader is registered', () => {
    expect(getTenantCacheStats().size).toBe(0)
  })
})
