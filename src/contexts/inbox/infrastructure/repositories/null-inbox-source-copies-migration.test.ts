// BQC-1.2 — bounded null-backfill integration test (real PostgreSQL).
//
// The current public inbox_items table has a validated content-free CHECK, so
// a legacy Review copy cannot be created there. A connection-local temporary
// table gives the historical backfill its real PostgreSQL seam without ever
// dropping or weakening the installed production constraint.

import type { PoolClient } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { nullInboxSourceCopies } from '../migrations/null-inbox-source-copies'

const ORG = 'org-null-backfill-test'
const IDS = [
  'aa000000-0000-4000-8000-0000000000b1',
  'aa000000-0000-4000-8000-0000000000b2',
  'aa000000-0000-4000-8000-0000000000b3',
  'aa000000-0000-4000-8000-0000000000b4',
  'aa000000-0000-4000-8000-0000000000b5',
  'aa000000-0000-4000-8000-0000000000b6',
]

let lease: TestLease
let client: PoolClient
let db: Pick<Database, 'execute'>

async function insertRow(
  id: string,
  sourceType: 'review' | 'feedback',
  withContent: boolean,
): Promise<void> {
  await client.query(
    `INSERT INTO inbox_items (
       id, organization_id, source_type, status, rating, snippet, reviewer_name
     ) VALUES ($1, $2, $3, 'open', $4, $5, $6)`,
    [
      id,
      ORG,
      sourceType,
      withContent ? 4 : null,
      withContent ? 'Source-owned content' : null,
      withContent ? 'Source-owned name' : null,
    ],
  )
}

async function contentRows(): Promise<
  Array<{
    id: string
    source_type: string
    rating: number | null
    snippet: string | null
    reviewer_name: string | null
    status: string
  }>
> {
  const result = await client.query(
    `SELECT id, source_type, rating, snippet, reviewer_name, status
     FROM inbox_items WHERE organization_id = $1 ORDER BY id`,
    [ORG],
  )
  return result.rows
}

describe('null-inbox-source-copies backfill (BQC-1.2)', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    client = await lease.pool.connect()
    await client.query(`
      CREATE TEMPORARY TABLE inbox_items (
        id uuid PRIMARY KEY,
        organization_id text NOT NULL,
        source_type text NOT NULL,
        status text NOT NULL,
        rating integer,
        snippet text,
        reviewer_name text
      ) ON COMMIT PRESERVE ROWS
    `)
    db = drizzle(client)
  })

  beforeEach(async () => {
    await client.query('TRUNCATE inbox_items')
    for (const [index, id] of IDS.entries()) {
      if (index < 4) await insertRow(id, 'review', true)
      else if (index === 4) await insertRow(id, 'review', false)
      else await insertRow(id, 'feedback', true)
    }
  })

  afterAll(async () => {
    client?.release()
    await lease?.release()
  })

  it('nulls Review copies in bounded batches without changing workflow or Feedback data', async () => {
    const batchLog: Array<[number, number]> = []
    const result = await nullInboxSourceCopies(db, {
      batchSize: 2,
      onBatch: (batch, rows) => batchLog.push([batch, rows]),
    })

    expect(result).toEqual({ batches: 2, rowsNulled: 4 })
    expect(batchLog).toEqual([
      [1, 2],
      [2, 2],
    ])

    const rows = await contentRows()
    expect(rows).toHaveLength(6)
    for (const row of rows.filter((candidate) => candidate.source_type === 'review')) {
      expect(row.rating).toBeNull()
      expect(row.snippet).toBeNull()
      expect(row.reviewer_name).toBeNull()
      expect(row.status).toBe('open')
    }
    expect(rows.find((row) => row.source_type === 'feedback')).toMatchObject({
      rating: 4,
      snippet: 'Source-owned content',
      reviewer_name: 'Source-owned name',
      status: 'open',
    })

    const publicConstraint = await client.query<{ convalidated: boolean }>(`
      SELECT convalidated
      FROM pg_constraint
      WHERE conname = 'inbox_items_review_source_content_free'
        AND conrelid = 'public.inbox_items'::regclass
    `)
    expect(publicConstraint.rows).toEqual([{ convalidated: true }])
  })

  it('is a no-op on re-run after the Review rows are clean', async () => {
    await nullInboxSourceCopies(db, { batchSize: 2 })

    await expect(nullInboxSourceCopies(db, { batchSize: 2 })).resolves.toEqual({
      batches: 0,
      rowsNulled: 0,
    })
  })
})
