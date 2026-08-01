// BQC-8.2 — unit tests for the external collectors (platform-side metrics
// the app cannot read itself). Hermetic: the redis-cli invocation is an
// injected command seam; the parser is pure.

import { describe, it, expect } from 'vitest'
import { parseRedisInfo, createRedisInfoCollector } from './external-collectors'

const T0 = 1_752_435_200_000

const INFO_SAMPLE = `# Server
redis_version:7.2.4

# Memory
used_memory:12345678
used_memory_human:11.77M
used_memory_peak:13456789
mem_fragmentation_ratio:1.12

# Stats
instantaneous_ops_per_sec:42
keyspace_hits:9001
keyspace_misses:99
`

describe('parseRedisInfo', () => {
  it('extracts the SLO-relevant memory + stats counters', () => {
    expect(parseRedisInfo(INFO_SAMPLE)).toEqual({
      usedMemoryBytes: 12345678,
      usedMemoryPeakBytes: 13456789,
      keyspaceHits: 9001,
      keyspaceMisses: 99,
      instantaneousOpsPerSec: 42,
    })
  })

  it('fails closed when a required counter is missing', () => {
    expect(() => parseRedisInfo('# Memory\nused_memory:1\n')).toThrow(/used_memory_peak/i)
    expect(() => parseRedisInfo('garbage')).toThrow(/used_memory/i)
  })
})

describe('createRedisInfoCollector', () => {
  it('collects one point per tick via the injected redis-cli seam', async () => {
    const calls: string[][] = []
    const collector = createRedisInfoCollector({
      redisUrl: 'redis://localhost:6379/9',
      clock: () => new Date(T0),
      run: async (args) => {
        calls.push([...args])
        return INFO_SAMPLE
      },
    })
    await collector.tick()
    await collector.tick()
    const series = await collector.stop()
    expect(series.collector).toBe('redis-info')
    expect(series.points).toHaveLength(2)
    expect(series.points[0]).toMatchObject({
      at: new Date(T0).toISOString(),
      usedMemoryBytes: 12345678,
      keyspaceHits: 9001,
    })
    expect(series.readErrors).toHaveLength(0)
    expect(calls[0]).toContain('redis://localhost:6379/9')
  })

  it('records read errors instead of throwing (never a silent gap, never a crash)', async () => {
    const collector = createRedisInfoCollector({
      redisUrl: 'redis://localhost:6379',
      clock: () => new Date(T0),
      run: async () => {
        throw new Error('redis-cli not found')
      },
    })
    await collector.tick()
    const series = await collector.stop()
    expect(series.points).toHaveLength(0)
    expect(series.readErrors).toHaveLength(1)
    expect(series.readErrors[0].message).toContain('redis-cli not found')
  })
})
