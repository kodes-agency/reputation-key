import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TestLease } from '#/shared/testing/test-environment-lease'
import { acquireTestLease } from '#/shared/testing/test-environment-lease'
import { getEnv } from '#/shared/config/env'

const ORG = 'org-inbox-content-migration-1111111111'
const REVIEW_ITEM = '6e000000-0000-4000-8000-000000000001'
const REVIEW_SOURCE = '6e000000-0000-4000-8000-000000000002'
const FEEDBACK_ITEM = '6e000000-0000-4000-8000-000000000003'
const FEEDBACK_SOURCE = '6e000000-0000-4000-8000-000000000004'
const MAX_SAFE_REVISION = '9007199254740991'
const CONSTRAINT = 'inbox_items_review_source_content_free'
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0126_inbox_review_source_content_free.sql'),
  'utf8',
)

let lease: TestLease

async function restoreConstraint(): Promise<void> {
  await lease.pool.query(
    `UPDATE inbox_items
     SET rating = NULL, snippet = NULL, reviewer_name = NULL
     WHERE source_type = 'review'
       AND (rating IS NOT NULL OR snippet IS NOT NULL OR reviewer_name IS NOT NULL)`,
  )
  await lease.pool.query(
    `ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`,
  )
  await lease.pool.query(
    `ALTER TABLE inbox_items
     ADD CONSTRAINT ${CONSTRAINT}
     CHECK (
       source_type <> 'review'
       OR (rating IS NULL AND snippet IS NULL AND reviewer_name IS NULL)
     ) NOT VALID`,
  )
  await lease.pool.query(`ALTER TABLE inbox_items VALIDATE CONSTRAINT ${CONSTRAINT}`)
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
})

beforeEach(async () => {
  await lease.pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await lease.pool.query(
    `ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`,
  )
  await lease.pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       rating, source_date, platform, snippet, reviewer_name, command_revision
     ) VALUES
       ($1, $2, 'legacy-property', 'review', $3, 'open',
        1, NOW(), 'google', 'legacy provider review text', 'Legacy guest', $4),
       ($5, $2, 'legacy-property', 'feedback', $6, 'open',
        2, NOW(), NULL, 'manager-owned private feedback', 'Feedback guest', 1)`,
    [REVIEW_ITEM, ORG, REVIEW_SOURCE, MAX_SAFE_REVISION, FEEDBACK_ITEM, FEEDBACK_SOURCE],
  )
})

afterEach(async () => {
  await restoreConstraint()
  await lease.pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
})

afterAll(async () => {
  await lease?.release()
})

describe.sequential('0126 Inbox Review source-content migration (PostgreSQL)', () => {
  it('backfills only Review projections and validates the future-write invariant', async () => {
    await lease.pool.query(migration)

    const rows = await lease.pool.query(
      `SELECT id, source_type, rating, snippet, reviewer_name,
              command_revision::text AS command_revision
       FROM inbox_items
       WHERE organization_id = $1
       ORDER BY id`,
      [ORG],
    )
    expect(rows.rows).toEqual([
      {
        id: REVIEW_ITEM,
        source_type: 'review',
        rating: null,
        snippet: null,
        reviewer_name: null,
        command_revision: MAX_SAFE_REVISION,
      },
      {
        id: FEEDBACK_ITEM,
        source_type: 'feedback',
        rating: 2,
        snippet: 'manager-owned private feedback',
        reviewer_name: 'Feedback guest',
        command_revision: '1',
      },
    ])

    const constraint = await lease.pool.query(
      `SELECT convalidated
       FROM pg_constraint
       WHERE conname = $1 AND conrelid = 'inbox_items'::regclass`,
      [CONSTRAINT],
    )
    expect(constraint.rows).toEqual([{ convalidated: true }])

    await expect(
      lease.pool.query(
        `UPDATE inbox_items SET snippet = 'provider text restored'
         WHERE id = $1`,
        [REVIEW_ITEM],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: CONSTRAINT })

    await expect(
      lease.pool.query(
        `UPDATE inbox_items SET snippet = 'updated private feedback'
         WHERE id = $1`,
        [FEEDBACK_ITEM],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
  })
})
