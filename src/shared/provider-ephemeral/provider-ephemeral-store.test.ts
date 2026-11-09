import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryProviderEphemeralStore } from './in-memory-store'
import { createRedisProviderEphemeralStore } from './provider-ephemeral-store'
import { describeProviderEphemeralStoreContract } from './provider-ephemeral-store.test-contract'

describeProviderEphemeralStoreContract('in-memory fake', async () => {
  let now = 1_000
  return {
    store: createInMemoryProviderEphemeralStore(() => now),
    advance: async (ms) => {
      now += ms
    },
  }
})

// The store keeps nothing across a restart (ADR 0050), so its start bounds
// what it can still hold: a value written before then is gone. The review
// sync reads it to tell a deploy's restart from a cursor that went missing.
describe('when a ProviderEphemeralStore started', () => {
  it('is the in-memory store creation', async () => {
    let now = 5_000
    const store = createInMemoryProviderEphemeralStore(() => now)
    now += 60_000

    await expect(store.startedAtMs()).resolves.toBe(5_000)
  })

  it('is the Redis server start, read from its uptime', async () => {
    const info = vi.fn(
      async () => '# Server\r\nredis_version:7.4.11\r\nuptime_in_seconds:120\r\n',
    )
    const store = createRedisProviderEphemeralStore(
      { info } as unknown as Redis,
      () => 1_000_000,
    )

    await expect(store.startedAtMs()).resolves.toBe(1_000_000 - 120_000)
    expect(info).toHaveBeenCalledWith('server')
  })

  it.each([
    '# Server\r\nredis_version:7.4.11\r\n',
    'uptime_in_seconds:-4\r\n',
    'uptime_in_seconds:1e9',
  ])('is unknown when Redis reports no usable uptime (%j)', async (raw) => {
    const store = createRedisProviderEphemeralStore(
      { info: vi.fn(async () => raw) } as unknown as Redis,
      () => 1_000_000,
    )

    await expect(store.startedAtMs()).resolves.toBeNull()
  })
})
