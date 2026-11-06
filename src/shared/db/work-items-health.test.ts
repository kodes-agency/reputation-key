import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { describe, expect, it, vi } from 'vitest'
import { createWorkItems } from './work-items.server'

describe('durable work quarantine metrics', () => {
  it('decodes the PostgreSQL timestamp aggregate before measuring terminal age', async () => {
    // The node-postgres Drizzle transport returns timestamps as strings.
    const query = vi.fn(async () => ({ rows: [[1, '2026-11-06 10:00:00+00']] }))
    const db = drizzle({ query } as unknown as Pool)
    const work = createWorkItems(db, () => new Date('2026-11-06T10:16:00Z'))

    expect(await work.readQuarantineMetrics('outbox-delivery')).toEqual({
      count: 1,
      oldestAgeMs: 16 * 60_000,
    })
  })

  it('reports no terminal age once the durable quarantine is empty', async () => {
    const query = vi.fn(async () => ({ rows: [[0, null]] }))
    const db = drizzle({ query } as unknown as Pool)
    const work = createWorkItems(db, () => new Date('2026-11-06T10:16:00Z'))

    expect(await work.readQuarantineMetrics('outbox-delivery')).toEqual({
      count: 0,
      oldestAgeMs: null,
    })
  })
})
