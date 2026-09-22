// The notification health reads' server-side budget (real PostgreSQL).
//
// The operations snapshot stops waiting for a health signal at its own
// per-signal cap, but a query it gave up on kept running — the delivery-lag
// linkage scan ran for 4–13 s on every five-minute evaluation, holding a pool
// connection and database CPU. Each read now runs in a read-only transaction
// under a PostgreSQL statement timeout: a blocked or runaway statement is
// cancelled and the read fails fast with a named, content-free error.
//
// A table lock held by another connection stands in for the slow statement:
// it blocks the read deterministically, however fast the machine.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { NotificationHealthReadTimeoutError } from './health-read-timeout'
import { createNotificationDeliveryLagRepository } from './notification-delivery-lag.repository'
import { createNotificationGapRepository } from './notification-gap.repository'

const WINDOW_END = new Date('2026-08-30T08:00:00.000Z')
const STATEMENT_TIMEOUT_MS = 200
/**
 * How long the lock is held at most. A read without a statement timeout waits
 * this long, then resolves — so the test fails instead of hanging.
 */
const LOCK_HELD_MS = 3_000

describe.sequential(
  'notification health read statement timeout (real PostgreSQL)',
  () => {
    let lease: TestLease
    // The reads run on one dedicated connection, so what they leave behind on
    // it is observable.
    let readerClient: Client
    let db: Database

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      readerClient = new Client({ connectionString: getEnv().DATABASE_URL })
      await readerClient.connect()
      db = drizzle(readerClient) as unknown as Database
    })

    afterAll(async () => {
      await readerClient?.end()
      await lease?.release()
    })

    /** Run `read` while another connection holds an ACCESS EXCLUSIVE lock on `table`. */
    async function whileLocked(table: string, read: () => Promise<unknown>) {
      const locker = await lease.pool.connect()
      await locker.query('BEGIN')
      await locker.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`)
      const release = setTimeout(() => void locker.query('ROLLBACK'), LOCK_HELD_MS)
      const startedAt = performance.now()
      try {
        const outcome = await read().then(
          () => 'resolved',
          (error: unknown) => error,
        )
        return { outcome, elapsedMs: performance.now() - startedAt }
      } finally {
        clearTimeout(release)
        await locker.query('ROLLBACK')
        locker.release()
      }
    }

    it('cancels a delivery-lag read blocked past its statement timeout', async () => {
      const repo = createNotificationDeliveryLagRepository(db, () => true)

      const { outcome, elapsedMs } = await whileLocked('notification_email_queue', () =>
        repo.read({
          recordedAtOrAfter: new Date(WINDOW_END.getTime() - 24 * 60 * 60 * 1000),
          recordedBefore: WINDOW_END,
          scanLimit: 10,
          statementTimeoutMs: STATEMENT_TIMEOUT_MS,
        }),
      )

      expect(outcome).toBeInstanceOf(NotificationHealthReadTimeoutError)
      expect(outcome).toMatchObject({
        name: 'NotificationHealthReadTimeoutError',
        code: 'statement_timeout',
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      })
      expect(elapsedMs).toBeLessThan(LOCK_HELD_MS)
    })

    it('cancels a notification-gap count blocked past its statement timeout', async () => {
      const repo = createNotificationGapRepository(db)

      const { outcome, elapsedMs } = await whileLocked('inbox_items', () =>
        repo.countItemsMissingNotifications({
          createdAtOrAfter: new Date(WINDOW_END.getTime() - 24 * 60 * 60 * 1000),
          createdBefore: WINDOW_END,
          scanLimit: 10,
          statementTimeoutMs: STATEMENT_TIMEOUT_MS,
        }),
      )

      expect(outcome).toBeInstanceOf(NotificationHealthReadTimeoutError)
      expect(elapsedMs).toBeLessThan(LOCK_HELD_MS)
    })

    it('leaves no statement timeout on the connection it read on', async () => {
      const repo = createNotificationGapRepository(db)

      await whileLocked('inbox_items', () =>
        repo.countItemsMissingNotifications({
          createdAtOrAfter: new Date(WINDOW_END.getTime() - 24 * 60 * 60 * 1000),
          createdBefore: WINDOW_END,
          scanLimit: 10,
          statementTimeoutMs: STATEMENT_TIMEOUT_MS,
        }),
      )
      const shown = await db.execute<{ statement_timeout: string }>(
        sql`SHOW statement_timeout`,
      )

      expect(shown.rows[0]?.statement_timeout).toBe('0')
    })
  },
)
