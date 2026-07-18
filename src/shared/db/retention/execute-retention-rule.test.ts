// BQC-3.7 — retention executor per-run drain bound (unit, fake db).
// The bounded-batch drain loop must stop at a per-run batch cap so one
// scheduled run cannot chase an unbounded backlog; the next scheduled run
// continues where this one stopped.

import { describe, it, expect, vi } from 'vitest'
import {
  executeRetentionRule,
  DEFAULT_MAX_BATCHES_PER_RUN,
  type RetentionRule,
} from './execute-retention-rule'
import type { Database } from '#/shared/db'

const RULE: RetentionRule = {
  subject: 'outbox_events.published',
  table: 'outbox_events',
  keyColumns: ['id'],
  tsColumn: 'published_at',
  olderThanMs: 30 * 24 * 60 * 60 * 1000,
  extraWhere: 'published_at IS NOT NULL',
}

const CUTOFF = new Date('2026-06-17T00:00:00.000Z')

function fakeDb(rowCounts: number[], fallbackRowCount = 0) {
  const execute = vi.fn()
  for (const count of rowCounts) {
    execute.mockResolvedValueOnce({ rowCount: count, rows: [] })
  }
  // Any call beyond the canned sequence returns the fallback (default: empty).
  execute.mockResolvedValue({ rowCount: fallbackRowCount, rows: [] })
  return { db: { execute } as unknown as Database, execute }
}

describe('retention executor per-run cap (BQC-3.7)', () => {
  it('stops at maxBatches with rows remaining and reports capped', async () => {
    const { db, execute } = fakeDb([2, 2, 2])

    const result = await executeRetentionRule(db, RULE, {
      cutoff: CUTOFF,
      batchSize: 2,
      maxBatches: 3,
    })

    expect(execute).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ batches: 3, rowsDeleted: 6, capped: true })
  })

  it('reports capped=false when the drain completes within the cap', async () => {
    // Final batch is partial → the backlog is exhausted, no cap reached.
    // (The drain probes until an empty batch — 2 deleting batches + 1 probe.)
    const { db, execute } = fakeDb([2, 1, 0])

    const result = await executeRetentionRule(db, RULE, {
      cutoff: CUTOFF,
      batchSize: 2,
      maxBatches: 3,
    })

    expect(execute).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ batches: 2, rowsDeleted: 3, capped: false })
  })

  it('a full final batch below the cap still probes once more (drain-complete proof)', async () => {
    const { db, execute } = fakeDb([2, 2, 0])

    const result = await executeRetentionRule(db, RULE, {
      cutoff: CUTOFF,
      batchSize: 2,
      maxBatches: 3,
    })

    expect(execute).toHaveBeenCalledTimes(3)
    expect(result.capped).toBe(false)
  })

  it('defaults to 100 batches per run (50k rows at batch size 500)', async () => {
    expect(DEFAULT_MAX_BATCHES_PER_RUN).toBe(100)
    // Unbounded backlog: every batch comes back full.
    const { db, execute } = fakeDb([], 500)

    const result = await executeRetentionRule(db, RULE, {
      cutoff: CUTOFF,
      batchSize: 500,
    })

    expect(execute).toHaveBeenCalledTimes(DEFAULT_MAX_BATCHES_PER_RUN)
    expect(result.batches).toBe(DEFAULT_MAX_BATCHES_PER_RUN)
    expect(result.capped).toBe(true)
  })
})
