// Cache port — interface for key-value caching.
// Per architecture: ports are TypeScript type aliases defining capability contracts.
// The implementation lives in infrastructure (redis-cache.ts).

export type Cache = Readonly<{
  /** Get a value by key. Returns null if missing or on error. */
  get<T>(key: string): Promise<T | null>

  /** Set a value with optional TTL in seconds. */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>

  /** Delete a key. No-op if the key doesn't exist. */
  delete(key: string): Promise<void>

  /** Check if a key exists. Returns false on error. */
  exists(key: string): Promise<boolean>
}>
