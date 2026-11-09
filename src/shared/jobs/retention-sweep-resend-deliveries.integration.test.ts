// Webhook delivery ids against real PostgreSQL. An id only has to outlast the
// provider's retry window, so the sweep removes older ones and keeps the rest.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { retentionRuleCutoff } from '#/shared/db/retention/retention-cutoff'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { RETENTION_RULES } from './retention-sweep.job'

const PREFIX = `retention-${randomUUID().slice(0, 8)}-`
const NOW = new Date('2026-09-22T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

let lease: TestLease
let db: Database

const seed = async (name: string, ageDays: number): Promise<void> => {
  await db.execute(sql`
    INSERT INTO resend_webhook_deliveries (event_id, applied_at)
    VALUES (${PREFIX + name}, ${daysAgo(ageDays).toISOString()}::timestamptz)
  `)
}

const remaining = async (): Promise<readonly string[]> =>
  (
    await db.execute<{ event_id: string }>(
      sql`SELECT event_id FROM resend_webhook_deliveries WHERE event_id LIKE ${PREFIX + '%'} ORDER BY event_id`,
    )
  ).rows.map((row) => row.event_id.slice(PREFIX.length))

const clear = async (): Promise<void> => {
  await db.execute(
    sql`DELETE FROM resend_webhook_deliveries WHERE event_id LIKE ${PREFIX + '%'}`,
  )
}

describe.sequential('webhook delivery retention (real PostgreSQL)', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    if (db) await clear()
    await lease?.release()
  })

  it('removes delivery ids past the retry window and keeps recent ones', async () => {
    const rule = RETENTION_RULES.find(
      ({ subject }) => subject === 'resend_webhook_deliveries',
    )
    if (!rule) throw new Error('resend_webhook_deliveries is not a retention rule')
    await seed('old', 30)
    await seed('recent', 1)

    await executeRetentionRule(
      db,
      { ...rule, extraWhere: `event_id LIKE '${PREFIX}%'` },
      { cutoff: retentionRuleCutoff(rule, NOW) },
    )

    expect(await remaining()).toEqual(['recent'])
  })
})
