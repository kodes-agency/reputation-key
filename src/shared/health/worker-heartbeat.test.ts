import { describe, expect, it, vi } from 'vitest'
import {
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  writeWorkerHeartbeat,
  readWorkerHeartbeat,
} from './worker-heartbeat'

const fixed = () => new Date('2026-07-16T12:00:00.000Z')

describe('writeWorkerHeartbeat', () => {
  it('no-ops without redis', async () => {
    await expect(writeWorkerHeartbeat(null, fixed)).resolves.toBeUndefined()
  })

  it('sets key with TTL', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK'), get: vi.fn() }
    await writeWorkerHeartbeat(redis, fixed)
    expect(redis.set).toHaveBeenCalledWith(
      WORKER_HEARTBEAT_KEY,
      '2026-07-16T12:00:00.000Z',
      'EX',
      WORKER_HEARTBEAT_TTL_SECONDS,
    )
  })
})

describe('readWorkerHeartbeat', () => {
  it('is stale when redis missing or key empty', async () => {
    await expect(readWorkerHeartbeat(null, fixed)).resolves.toEqual({
      at: null,
      ageMs: null,
      stale: true,
    })
    const redis = { set: vi.fn(), get: vi.fn().mockResolvedValue(null) }
    await expect(readWorkerHeartbeat(redis, fixed)).resolves.toMatchObject({
      stale: true,
    })
  })

  it('computes age and freshness', async () => {
    const redis = {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue('2026-07-16T11:59:00.000Z'),
    }
    await expect(readWorkerHeartbeat(redis, fixed)).resolves.toEqual({
      at: '2026-07-16T11:59:00.000Z',
      ageMs: 60_000,
      stale: false,
    })
  })

  it('marks old heartbeats stale', async () => {
    const redis = {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue('2026-07-16T11:00:00.000Z'),
    }
    const result = await readWorkerHeartbeat(redis, fixed)
    expect(result.stale).toBe(true)
    expect(result.ageMs).toBe(3_600_000)
  })
})
