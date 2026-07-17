// BQC-1.2 — bounded null-backfill integration test (real PostgreSQL).
// Proves: batches are bounded, every copy is nulled, workflow fields are
// untouched, and re-running is a no-op (idempotent/resumable).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { nullInboxSourceCopies } from '../migrations/null-inbox-source-copies'

const ORG = 'org-null-backfill-test'
const IDS = [
  'aa000000-0000-4000-8000-0000000000b1',
  'aa000000-0000-4000-8000-0000000000b2',
  'aa000000-0000-4000-8000-0000000000b3',
  'aa000000-0000-4000-8000-0000000000b4',
  'aa000000-0000-4000-8000-0000000000b5',
]

const db = getDb()

async function insertRow(id: string, withContent: boolean): Promise<void> {
  await db.execute(sql`
    INSERT INTO inbox_items (
      id, organization_id, property_id, source_type, source_id, status,
      is_escalated, source_date, platform, rating, snippet, reviewer_name
    ) VALUES (
      ${id}, ${ORG}, 'prop-1', 'review', ${id}, 'open',
      false, now(), 'google',
      ${withContent ? 4 : null},
      ${withContent ? 'Full raw review text copy' : null},
      ${withContent ? 'Raw Reviewer Name' : null}
    )
  `)
}

async function contentRows(): Promise<
  Array<{
    id: string
    rating: number | null
    snippet: string | null
    reviewer_name: string | null
    status: string
  }>
> {
  const result = await db.execute(sql`
    SELECT id, rating, snippet, reviewer_name, status
    FROM inbox_items WHERE organization_id = ${ORG} ORDER BY id
  `)
  return result.rows as Array<{
    id: string
    rating: number | null
    snippet: string | null
    reviewer_name: string | null
    status: string
  }>
}

describe('null-inbox-source-copies backfill (BQC-1.2)', () => {
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM inbox_items WHERE organization_id = ${ORG}`)
    for (const [i, id] of IDS.entries()) {
      await insertRow(id, i < 4) // 4 with content, 1 already clean
    }
  })

  afterAll(async () => {
    await db.execute(sql`DELETE FROM inbox_items WHERE organization_id = ${ORG}`)
  })

  it('nulls every copy in bounded batches and preserves workflow fields', async () => {
    const batchLog: Array<[number, number]> = []
    const result = await nullInboxSourceCopies(db, {
      batchSize: 2,
      onBatch: (batch, rows) => batchLog.push([batch, rows]),
    })

    // 4 content rows at batch size 2 → exactly 2 batches of 2
    expect(result.batches).toBe(2)
    expect(result.rowsNulled).toBe(4)
    expect(batchLog).toEqual([
      [1, 2],
      [2, 2],
    ])

    const rows = await contentRows()
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.rating).toBeNull()
      expect(row.snippet).toBeNull()
      expect(row.reviewer_name).toBeNull()
      // workflow fields untouched
      expect(row.status).toBe('open')
    }
  })

  it('is a no-op on re-run (idempotent / resumable)', async () => {
    const result = await nullInboxSourceCopies(db, { batchSize: 2 })
    expect(result.batches).toBe(0)
    expect(result.rowsNulled).toBe(0)
  })
})
