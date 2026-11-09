import { expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { closeRetentionRun, openRetentionRun } from './evidence'

it('stamps metric-reading expiry evidence with the policy that includes its rule', async () => {
  const execute = vi.fn(async (_query: SQL) => ({ rows: [{ id: 'run-id' }] }))
  const db = { execute } as unknown as Database
  const at = new Date('2026-11-09T00:00:00Z')
  const id = await openRetentionRun(db, 'metric_readings.expired', 500, at)
  expect(id).toBe('run-id')
  await closeRetentionRun(db, id, {
    finishedAt: at,
    rowsDeleted: 2,
    outcome: 'completed',
  })
  const dialect = new PgDialect()
  expect(dialect.sqlToQuery(execute.mock.calls[0]![0]).params).toEqual([
    'metric_readings.expired',
    at,
    500,
    11,
  ])
  expect(dialect.sqlToQuery(execute.mock.calls[1]![0]).params).toEqual([
    at,
    0,
    2,
    0,
    'completed',
    null,
    11,
    'run-id',
  ])
})
