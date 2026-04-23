// No-op cache — used when Redis is unavailable (dev mode or misconfiguration).
// Implements the Cache port with safe no-op behavior.

import type { Cache } from './cache.port'

export function createNoopCache(): Cache {
  return {
    async get<T>(_key: string): Promise<T | null> {
      return null
    },

    async set(_key: string, _value: unknown, _ttlSeconds?: number): Promise<void> {
      // no-op
    },

    async delete(_key: string): Promise<void> {
      // no-op
    },

    async exists(_key: string): Promise<boolean> {
      return false
    },
  }
}
