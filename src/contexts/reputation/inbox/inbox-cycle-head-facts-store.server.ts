// Inbox context — copying the Handling Cycle head's facts onto the Inbox row.
//
// `inbox_items` carries the current cycle number, source revision and state
// revision beside the head table (migration 0158). The migration only adds the
// columns, so this walk copies the values from the heads in bounded batches and
// can run again: a row an older release moved in between, or one the new code has
// not touched yet, is found by its facts differing from its head's.
//
// Both rows are locked for a batch, item first like every writer, so the walk
// cannot overwrite facts a command committed after the batch was read: the
// statement re-checks each pair once it holds the locks.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type CycleHeadFactsBatch = Readonly<{
  /** Rows whose facts differ from their head's. */
  rows: number
  /** The last item id the batch covered, null when it covered none. */
  last: string | null
}>

export type CycleHeadFactsParity = Readonly<{
  items: number
  withHead: number
  factsDiffer: number
  statusDiffers: number
}>

type BatchRequest = Readonly<{ after: string | null; limit: number }>

export type CycleHeadFactsStore = Readonly<{
  parity: () => Promise<CycleHeadFactsParity>
  scan: (input: BatchRequest) => Promise<CycleHeadFactsBatch>
  backfill: (input: BatchRequest) => Promise<CycleHeadFactsBatch>
}>

const FIRST_UUID = '00000000-0000-0000-0000-000000000000'

const FACTS_DIFFER = sql`(item.current_cycle_number, item.current_source_revision, item.state_revision)
  IS DISTINCT FROM
  (head.current_cycle_number, head.current_source_revision, head.state_revision)`

type BatchRow = Readonly<{ rows: number; last: string | null }>

const toBatch = (row: BatchRow | undefined): CycleHeadFactsBatch => ({
  rows: Number(row?.rows ?? 0),
  last: row?.last ?? null,
})

export const createCycleHeadFactsStore = (db: Database): CycleHeadFactsStore => ({
  parity: async () => {
    const result = await db.execute<
      Readonly<{
        items: number
        with_head: number
        facts_differ: number
        status_differs: number
      }>
    >(sql`
      SELECT count(*)::int AS items,
             count(head.inbox_item_id)::int AS with_head,
             count(*) FILTER (WHERE head.inbox_item_id IS NOT NULL AND ${FACTS_DIFFER})::int AS facts_differ,
             count(*) FILTER (WHERE head.inbox_item_id IS NOT NULL AND item.status <> head.status)::int AS status_differs
        FROM inbox_items AS item
        LEFT JOIN inbox_handling_cycle_heads AS head ON head.inbox_item_id = item.id`)
    const row = result.rows[0]
    return {
      items: Number(row?.items ?? 0),
      withHead: Number(row?.with_head ?? 0),
      factsDiffer: Number(row?.facts_differ ?? 0),
      statusDiffers: Number(row?.status_differs ?? 0),
    }
  },

  scan: async ({ after, limit }) => {
    const result = await db.execute<BatchRow>(sql`
      WITH batch AS (
        SELECT item.id
          FROM inbox_items AS item
          JOIN inbox_handling_cycle_heads AS head ON head.inbox_item_id = item.id
         WHERE item.id > ${after ?? FIRST_UUID}::uuid AND ${FACTS_DIFFER}
         ORDER BY item.id
         LIMIT ${limit}
      )
      SELECT count(*)::int AS rows, (SELECT id FROM batch ORDER BY id DESC LIMIT 1) AS last
        FROM batch`)
    return toBatch(result.rows[0])
  },

  backfill: async ({ after, limit }) => {
    const result = await db.execute<BatchRow>(sql`
      WITH batch AS (
        SELECT item.id,
               head.current_cycle_number AS cycle_number,
               head.current_source_revision AS source_revision,
               head.state_revision AS state_revision
          FROM inbox_items AS item
          JOIN inbox_handling_cycle_heads AS head ON head.inbox_item_id = item.id
         WHERE item.id > ${after ?? FIRST_UUID}::uuid AND ${FACTS_DIFFER}
         ORDER BY item.id
         LIMIT ${limit}
           FOR UPDATE OF item, head
      ), written AS (
        UPDATE inbox_items AS target
           SET current_cycle_number = batch.cycle_number,
               current_source_revision = batch.source_revision,
               state_revision = batch.state_revision
          FROM batch
         WHERE target.id = batch.id
        RETURNING target.id
      )
      SELECT (SELECT count(*) FROM written)::int AS rows,
             (SELECT id FROM batch ORDER BY id DESC LIMIT 1) AS last`)
    return toBatch(result.rows[0])
  },
})
