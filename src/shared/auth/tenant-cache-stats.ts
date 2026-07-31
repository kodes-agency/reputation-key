// BQC-7.3 — tenant-resolution cache counters (cache.tenant.* metric family).
//
// Module-level counters incremented by tenant-resolver at the natural hit /
// miss / eviction points and read into the OperationsSnapshot. Kept in a
// standalone module (no auth-stack imports) so the health/observability side
// can read stats without pulling in better-auth. Counters are process-local
// monotonic totals — aggregation/rate math is BQC-7.4's.

export type TenantCacheStats = Readonly<{
  /** Served from a fresh cache entry (incl. version-verified serves). */
  hits: number
  /** Lookups that resolved fresh (no entry, TTL-expired, or version-stale). */
  misses: number
  /** Entries evicted (max-size FIFO) or dropped (permission_version moved). */
  evictions: number
  /** Current entry count. */
  size: number
}>

const counters = { hits: 0, misses: 0, evictions: 0 }

/** The cache owner (tenant-resolver) registers its live size reader at load. */
let sizeReader: () => number = () => 0

export function registerTenantCacheSizeReader(read: () => number): void {
  sizeReader = read
}

export function recordTenantCacheHit(): void {
  counters.hits++
}

export function recordTenantCacheMiss(): void {
  counters.misses++
}

export function recordTenantCacheEviction(): void {
  counters.evictions++
}

/** Read the counters + the current size (via the registered reader). */
export function getTenantCacheStats(): TenantCacheStats {
  return { ...counters, size: sizeReader() }
}

/** Reset counters — test-only (paired with resetTenantResolutionCache). */
export function resetTenantCacheStats(): void {
  counters.hits = 0
  counters.misses = 0
  counters.evictions = 0
}
