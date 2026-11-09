// BQC-3.7 — retention executor per-run drain bound (unit, fake db).
// The bounded-batch drain loop must stop at a per-run batch cap so one
// scheduled run cannot chase an unbounded backlog; the next scheduled run
// continues where this one stopped.

import { assert, describe, it, expect, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
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
  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects an invalid batch bound %s before SQL',
    async (bound) => {
      const { db, execute } = fakeDb([])
      await expect(
        executeRetentionRule(db, RULE, { cutoff: CUTOFF, batchSize: bound }),
      ).rejects.toThrow('batchSize must be a positive safe integer')
      await expect(
        executeRetentionRule(db, RULE, { cutoff: CUTOFF, maxBatches: bound }),
      ).rejects.toThrow('maxBatches must be a positive safe integer')
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('rechecks expiry in the delete so a concurrently refreshed row survives', async () => {
    const { db, execute } = fakeDb([0])
    await executeRetentionRule(db, RULE, { cutoff: CUTOFF, batchSize: 2 })
    const firstCall = execute.mock.calls[0]
    assert.isDefined(firstCall)
    const compiled = new PgDialect().sqlToQuery(firstCall[0] as SQL)
    expect(compiled.sql).toMatch(/LIMIT \$\d+\) AND "published_at" < \$\d+/)
    expect(compiled.params).toEqual([CUTOFF, 2, CUTOFF])
  })

  it('resumes capped work by selecting only the remaining eligible rows', async () => {
    let remaining = 5
    const execute = vi.fn(async () => {
      const rowCount = Math.min(2, remaining)
      remaining -= rowCount
      return { rowCount, rows: [] }
    })
    const db = { execute } as unknown as Database
    expect(
      await executeRetentionRule(db, RULE, {
        cutoff: CUTOFF,
        batchSize: 2,
        maxBatches: 1,
      }),
    ).toMatchObject({ rowsDeleted: 2, capped: true })
    expect(
      await executeRetentionRule(db, RULE, {
        cutoff: CUTOFF,
        batchSize: 2,
        maxBatches: 2,
      }),
    ).toMatchObject({ rowsDeleted: 3, capped: false })
    expect(remaining).toBe(0)
  })

  it('binds runtime equality and limit values as query parameters', async () => {
    const { db, execute } = fakeDb([0])
    const runtimeScope = "org' OR TRUE --"

    await executeRetentionRule(
      db,
      {
        subject: 'reviews.purge.property',
        table: 'reviews',
        keyColumns: ['id'],
        tsColumn: 'id',
        olderThanMs: 0,
        equalsWhere: [
          { column: 'organization_id', value: runtimeScope },
          { column: 'property_id', value: 'property-runtime' },
        ],
      },
      { cutoff: CUTOFF, batchSize: 25 },
    )

    const compiled = new PgDialect().sqlToQuery(
      execute.mock.calls[0][0] as unknown as SQL,
    )
    expect(compiled.sql).not.toContain(runtimeScope)
    expect(compiled.sql).toContain('"organization_id" = $1')
    expect(compiled.sql).toContain('"property_id" = $2')
    expect(compiled.params).toEqual([
      runtimeScope,
      'property-runtime',
      25,
      runtimeScope,
      'property-runtime',
    ])
  })

  it('binds the age cutoff instead of embedding its ISO value', async () => {
    const { db, execute } = fakeDb([0])

    await executeRetentionRule(db, RULE, { cutoff: CUTOFF, batchSize: 25 })

    const compiled = new PgDialect().sqlToQuery(
      execute.mock.calls[0][0] as unknown as SQL,
    )
    expect(compiled.sql).not.toContain(CUTOFF.toISOString())
    expect(compiled.sql).toContain('"published_at" < $1')
    expect(compiled.params).toEqual([CUTOFF, 25, CUTOFF])
  })

  it('redacts protected columns without deleting the retained business row', async () => {
    const { db, execute } = fakeDb([2, 1, 0])
    const result = await executeRetentionRule(
      db,
      {
        subject: 'scan_events.abuse_pseudonym',
        table: 'scan_events',
        keyColumns: ['id'],
        tsColumn: 'created_at',
        olderThanMs: 7 * 24 * 60 * 60 * 1000,
        operation: 'redact',
        redactColumns: ['ip_hash'],
        extraWhere: 'ip_hash IS NOT NULL',
      },
      { cutoff: CUTOFF, batchSize: 2 },
    )

    expect(result).toEqual({
      batches: 2,
      rowsDeleted: 0,
      rowsRedacted: 3,
      capped: false,
    })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('stops at maxBatches with rows remaining and reports capped', async () => {
    const { db, execute } = fakeDb([2, 2, 2])

    const result = await executeRetentionRule(db, RULE, {
      cutoff: CUTOFF,
      batchSize: 2,
      maxBatches: 3,
    })

    expect(execute).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      batches: 3,
      rowsDeleted: 6,
      rowsRedacted: 0,
      capped: true,
    })
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
    expect(result).toEqual({
      batches: 2,
      rowsDeleted: 3,
      rowsRedacted: 0,
      capped: false,
    })
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

describe('retention executor dependents', () => {
  const PARENT_RULE: RetentionRule = {
    subject: 'metric_readings.expired',
    table: 'metric_readings',
    keyColumns: ['id'],
    tsColumn: 'recorded_at',
    olderThanMonths: 24,
    dependents: [
      {
        table: 'metric_corrections',
        referenceColumn: 'reading_id',
        keyColumn: 'id',
        selfReferenceColumn: 'supersedes_correction_id',
      },
    ],
  }

  function fakeTransactionDb(statements: string[], dependentPasses: number[]) {
    let batch = 0
    const dialect = new PgDialect()
    const tx = {
      execute: vi.fn(async (statement: SQL) => {
        const text = dialect.sqlToQuery(statement).sql
        statements.push(text)
        if (text.includes('FOR UPDATE')) {
          batch += 1
          return { rows: batch === 1 ? [{ id: 'r1' }, { id: 'r2' }] : [], rowCount: 0 }
        }
        if (text.startsWith('DELETE FROM "metric_corrections"')) {
          return { rowCount: dependentPasses.shift() ?? 0, rows: [] }
        }
        return { rowCount: 2, rows: [] }
      }),
    }
    const db = {
      execute: vi.fn(),
      transaction: vi.fn(async (run: (t: typeof tx) => Promise<number>) => run(tx)),
    } as unknown as Database
    return db
  }

  it('deletes corrections leaf-first, then the readings, in one transaction per batch', async () => {
    const statements: string[] = []
    const db = fakeTransactionDb(statements, [2, 1, 0])

    const result = await executeRetentionRule(db, PARENT_RULE, {
      cutoff: CUTOFF,
      batchSize: 2,
    })

    expect(result).toMatchObject({ batches: 1, rowsDeleted: 2, capped: false })
    expect(statements[0]).toContain('FOR UPDATE')
    expect(
      statements.filter((s) => s.startsWith('DELETE FROM "metric_corrections"')),
    ).toHaveLength(3)
    const readingDelete = statements.find((s) =>
      s.startsWith('DELETE FROM "metric_readings"'),
    )
    expect(readingDelete).toContain('"recorded_at" < $')
    expect(statements.indexOf(readingDelete ?? '')).toBeGreaterThan(
      statements.lastIndexOf(
        statements
          .filter((s) => s.startsWith('DELETE FROM "metric_corrections"'))
          .at(-1) ?? '',
      ),
    )
  })

  it('refuses dependents on a redaction or a composite key', async () => {
    const { db } = fakeDb([])
    await expect(
      executeRetentionRule(
        db,
        { ...PARENT_RULE, keyColumns: ['a', 'b'] },
        { cutoff: CUTOFF },
      ),
    ).rejects.toThrow('one key column')
  })
})
