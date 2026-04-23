// Tests for noop cache — verifies safe no-op behavior when Redis is unavailable
import { describe, it, expect } from 'vitest'
import { createNoopCache } from './noop-cache'

describe('createNoopCache', () => {
  const cache = createNoopCache()

  it('get returns null for any key', async () => {
    const result = await cache.get('any-key')
    expect(result).toBeNull()
  })

  it('set does not throw', async () => {
    await expect(cache.set('key', 'value')).resolves.toBeUndefined()
  })

  it('set with TTL does not throw', async () => {
    await expect(cache.set('key', 'value', 60)).resolves.toBeUndefined()
  })

  it('delete does not throw', async () => {
    await expect(cache.delete('key')).resolves.toBeUndefined()
  })

  it('exists returns false for any key', async () => {
    await cache.set('key', 'value')
    expect(await cache.exists('key')).toBe(false)
  })
})
