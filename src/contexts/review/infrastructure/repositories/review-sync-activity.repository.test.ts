// Review context — discovery-activity recorder integration tests.
//
// Proves the two ladder stamps against real Postgres: they create the
// review_sync_state row when it is missing, they never move a recorded
// instant backwards, and the push stamp's next-poll clamp can only pull a
// parked property EARLIER — never to a past (permanently overdue) time.
//
// Own ID space (f2…), distinct from the discovery repository suite's; cleanup
// is per-file and the database is shared. review_sync_state.property_id is a
// plain varchar (operational isolation, no FK), so no organization or
// property row is needed.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { createReviewSyncActivityRecorder } from './review-sync-activity.repository'

const PROP = 'f2000000-0000-4000-8000-000000000001'

const NOW = new Date('2026-08-21T12:00:00.000Z')
const EARLIER = new Date('2026-08-21T09:00:00.000Z')
const HOT_INTERVAL_MS = 15 * 60 * 1000

let pool: Pool
const db = getDb()

type StateRow = Readonly<{
  last_new_review_at: Date | null
  last_notification_at: Date | null
  next_incremental_at: Date | null
}>

async function readState(): Promise<StateRow | undefined> {
  const result = await pool.query<StateRow>(
    `SELECT last_new_review_at, last_notification_at, next_incremental_at
       FROM review_sync_state WHERE property_id = $1 AND source = 'google'`,
    [PROP],
  )
  return result.rows[0]
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
})

afterAll(async () => {
  await pool.query(`DELETE FROM review_sync_state WHERE property_id = $1`, [PROP])
  await pool.end()
})

beforeEach(async () => {
  await pool.query(`DELETE FROM review_sync_state WHERE property_id = $1`, [PROP])
})

describe('reviewSyncActivityRecorder (integration)', () => {
  it('creates the sync-state row when a new review is observed for a never-swept property', async () => {
    const recorder = createReviewSyncActivityRecorder(db)

    await recorder.recordNewReviewObserved(PROP, NOW)

    const row = await readState()
    expect(row?.last_new_review_at).toEqual(NOW)
    // The stamp is not a schedule: it must not invent a next poll time.
    expect(row?.next_incremental_at).toBeNull()
  })

  it('never moves last_new_review_at backwards on a replayed page', async () => {
    const recorder = createReviewSyncActivityRecorder(db)

    await recorder.recordNewReviewObserved(PROP, NOW)
    await recorder.recordNewReviewObserved(PROP, EARLIER)

    expect((await readState())?.last_new_review_at).toEqual(NOW)
  })

  it('stamps a push and pulls a far-future parked poll forward to the hot interval', async () => {
    const recorder = createReviewSyncActivityRecorder(db)
    const parkedAt = new Date(NOW.getTime() + 6 * 60 * 60 * 1000)
    await pool.query(
      `INSERT INTO review_sync_state (property_id, source, next_incremental_at, updated_at)
       VALUES ($1, 'google', $2, NOW())`,
      // The remainder of this test matches 'sets the next poll on a push for a
      // property that had none': same recordPushObserved call, same two column
      // assertions. Only the arrange differs, and the arrange is the subject —
      // this one seeds a far-future parked poll to prove it is pulled forward,
      // the other seeds no row at all to prove one is created. A shared
      // assertion helper would separate the expected columns from the seeded
      // precondition that explains them. Revisit if the push-stamp cases grow
      // past a handful: then a table of seeded → expected next_incremental_at.
      // fallow-ignore-next-line code-duplication
      [PROP, parkedAt],
    )

    await recorder.recordPushObserved(
      PROP,
      NOW,
      new Date(NOW.getTime() + HOT_INTERVAL_MS),
    )

    const row = await readState()
    expect(row?.last_notification_at).toEqual(NOW)
    expect(row?.next_incremental_at).toEqual(new Date(NOW.getTime() + HOT_INTERVAL_MS))
  })

  it('leaves an already-sooner next poll alone rather than pushing it out', async () => {
    const recorder = createReviewSyncActivityRecorder(db)
    const soon = new Date(NOW.getTime() + 60 * 1000)
    await pool.query(
      `INSERT INTO review_sync_state (property_id, source, next_incremental_at, updated_at)
       VALUES ($1, 'google', $2, NOW())`,
      [PROP, soon],
    )

    await recorder.recordPushObserved(
      PROP,
      NOW,
      new Date(NOW.getTime() + HOT_INTERVAL_MS),
    )

    expect((await readState())?.next_incremental_at).toEqual(soon)
  })

  it('sets the next poll on a push for a property that had none', async () => {
    const recorder = createReviewSyncActivityRecorder(db)

    await recorder.recordPushObserved(
      PROP,
      NOW,
      new Date(NOW.getTime() + HOT_INTERVAL_MS),
    )

    const row = await readState()
    expect(row?.last_notification_at).toEqual(NOW)
    expect(row?.next_incremental_at).toEqual(new Date(NOW.getTime() + HOT_INTERVAL_MS))
  })

  it('never moves last_notification_at backwards on a redelivered push', async () => {
    const recorder = createReviewSyncActivityRecorder(db)

    await recorder.recordPushObserved(
      PROP,
      NOW,
      new Date(NOW.getTime() + HOT_INTERVAL_MS),
    )
    await recorder.recordPushObserved(
      PROP,
      EARLIER,
      new Date(EARLIER.getTime() + HOT_INTERVAL_MS),
    )

    expect((await readState())?.last_notification_at).toEqual(NOW)
  })

  it('keeps the two stamps independent', async () => {
    const recorder = createReviewSyncActivityRecorder(db)

    await recorder.recordNewReviewObserved(PROP, EARLIER)
    await recorder.recordPushObserved(
      PROP,
      NOW,
      new Date(NOW.getTime() + HOT_INTERVAL_MS),
    )

    const row = await readState()
    expect(row?.last_new_review_at).toEqual(EARLIER)
    expect(row?.last_notification_at).toEqual(NOW)
  })
})
