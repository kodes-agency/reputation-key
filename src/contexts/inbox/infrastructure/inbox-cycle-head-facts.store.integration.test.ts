import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createCycleHeadFactsStore } from './inbox-cycle-head-facts.store'

const ORG_ID = 'org-cycle-facts-000000000000000001'
const PROPERTY_ID = '5f000000-0000-0000-0000-000000000001'
const ITEM_IDS = [
  '5f000000-0000-0000-0000-0000000000a1',
  '5f000000-0000-0000-0000-0000000000a2',
  '5f000000-0000-0000-0000-0000000000a3',
] as const
const [FIRST, SECOND, THIRD] = ITEM_IDS
const HEADLESS_ITEM = '5f000000-0000-0000-0000-0000000000a4'
const OPENED_AT = new Date('2026-08-26T10:00:00.000Z')

let pool: Pool
const store = createCycleHeadFactsStore(getDb())

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG_ID])
  await deleteTestOrganizations(pool, [ORG_ID])
}

async function seedFeedbackItem(
  id: string,
  head: { cycle: number; revision: number; state: number } | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status, source_date
     ) VALUES ($1, $2, $3, 'feedback', $1, 'open', $4)`,
    [id, ORG_ID, PROPERTY_ID, OPENED_AT],
  )
  if (head === null) return
  for (let cycle = 1; cycle <= head.cycle; cycle += 1) {
    await pool.query(
      `INSERT INTO inbox_handling_cycles (
         inbox_item_id, cycle_number, organization_id, property_id, source_type,
         source_id, source_revision, opened_reason, opened_at
       ) VALUES ($1, $2, $3, $4, 'feedback', $1, $5, 'feedback_submitted', $6)`,
      [id, cycle, ORG_ID, PROPERTY_ID, head.revision, OPENED_AT],
    )
  }
  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, current_cycle_number, state_revision, status
     ) VALUES ($1, $2, $3, 'feedback', $1, $4, $5, $6, 'open')`,
    [id, ORG_ID, PROPERTY_ID, head.revision, head.cycle, head.state],
  )
}

const factsOf = async (id: string) => {
  const result = await pool.query(
    `SELECT current_cycle_number::int AS cycle, current_source_revision::int AS revision,
            state_revision::int AS state
       FROM inbox_items WHERE id = $1`,
    [id],
  )
  return result.rows[0]
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Cycle Facts Test', 'cycle-facts-0001', NOW())`,
    [ORG_ID],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Facts Property', 'facts-property', 'UTC', 0, NOW(), NOW())`,
    [PROPERTY_ID, ORG_ID],
  )
  await seedFeedbackItem(FIRST, { cycle: 1, revision: 1, state: 1 })
  await seedFeedbackItem(SECOND, { cycle: 2, revision: 3, state: 4 })
  await seedFeedbackItem(THIRD, { cycle: 1, revision: 1, state: 2 })
  await seedFeedbackItem(HEADLESS_ITEM, null)
})

describe.sequential('Inbox cycle head facts backfill (PostgreSQL)', () => {
  it('copies the facts of every item that has a head and leaves a headless item alone', async () => {
    const batch = await store.backfill({ after: null, limit: 100 })

    expect(batch.rows).toBe(3)
    await expect(factsOf(FIRST)).resolves.toEqual({ cycle: 1, revision: 1, state: 1 })
    await expect(factsOf(SECOND)).resolves.toEqual({ cycle: 2, revision: 3, state: 4 })
    await expect(factsOf(HEADLESS_ITEM)).resolves.toEqual({
      cycle: null,
      revision: null,
      state: null,
    })
  })

  it('walks in item order, one bounded batch at a time, and a second walk finds nothing', async () => {
    const first = await store.backfill({ after: null, limit: 2 })
    expect(first).toEqual({ rows: 2, last: SECOND })
    await expect(factsOf(THIRD)).resolves.toMatchObject({ cycle: null })

    const second = await store.backfill({ after: first.last, limit: 2 })
    expect(second).toEqual({ rows: 1, last: THIRD })

    await expect(store.backfill({ after: null, limit: 100 })).resolves.toEqual({
      rows: 0,
      last: null,
    })
  })

  it('reports the same rows without writing when it only scans', async () => {
    await expect(store.scan({ after: null, limit: 100 })).resolves.toEqual({
      rows: 3,
      last: THIRD,
    })
    await expect(factsOf(FIRST)).resolves.toMatchObject({ cycle: null })
  })

  it('repairs a row an older release moved on the head only', async () => {
    await store.backfill({ after: null, limit: 100 })
    await pool.query(
      `UPDATE inbox_handling_cycle_heads SET state_revision = 9 WHERE inbox_item_id = $1`,
      [FIRST],
    )

    await expect(store.parity()).resolves.toMatchObject({ factsDiffer: 1 })
    await store.backfill({ after: null, limit: 100 })
    await expect(factsOf(FIRST)).resolves.toMatchObject({ state: 9 })
    await expect(store.parity()).resolves.toEqual({
      items: 4,
      withHead: 3,
      factsDiffer: 0,
      statusDiffers: 0,
    })
  })
})
