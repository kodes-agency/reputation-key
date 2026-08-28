import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const MIGRATION = resolve(process.cwd(), 'drizzle/0123_inbox_command_revisions.sql')
const FIXTURE_SCHEMA = 'inbox_command_revision_fixture'
const ITEM_ID = 'c3000000-0000-4000-8000-000000000001'
const LEGACY_ITEM_ID = 'c3000000-0000-4000-8000-000000000003'
const PROPERTY_ID = 'c3000000-0000-4000-8000-000000000002'
const LEGACY_PROPERTY_ID = 'legacy-property-key'

const schemaScoped = (sql: string): string =>
  sql.replaceAll('"public".', `"${FIXTURE_SCHEMA}".`)

async function setFixtureSearchPath(client: PoolClient): Promise<void> {
  await client.query(`SET search_path TO "${FIXTURE_SCHEMA}", public`)
}

describe.sequential('Inbox command-revision migration', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  })

  afterAll(async () => {
    await lease.pool.query(`DROP SCHEMA IF EXISTS "${FIXTURE_SCHEMA}" CASCADE`)
    await lease.release()
  })

  it('fences competing writers and protects assignment history as ALWAYS immutable', async () => {
    const setup = await lease.pool.connect()
    try {
      await setup.query(`DROP SCHEMA IF EXISTS "${FIXTURE_SCHEMA}" CASCADE`)
      await setup.query(`CREATE SCHEMA "${FIXTURE_SCHEMA}"`)
      await setFixtureSearchPath(setup)
      await setup.query('CREATE TABLE inbox_items (id uuid PRIMARY KEY)')
      await setup.query(schemaScoped(readFileSync(MIGRATION, 'utf8')))
      await setup.query('INSERT INTO inbox_items (id) VALUES ($1)', [ITEM_ID])
    } finally {
      setup.release()
    }

    const winner = await lease.pool.connect()
    const loser = await lease.pool.connect()
    try {
      await setFixtureSearchPath(winner)
      await setFixtureSearchPath(loser)
      await winner.query('BEGIN')
      await loser.query('BEGIN')

      const won = await winner.query<{ command_revision: string }>(
        `UPDATE inbox_items
         SET command_revision = command_revision + 1
         WHERE id = $1 AND command_revision = 1
         RETURNING command_revision::text`,
        [ITEM_ID],
      )
      expect(won.rows).toEqual([{ command_revision: '2' }])
      await winner.query(
        `INSERT INTO inbox_assignment_history (
           inbox_item_id, resulting_command_revision, organization_id,
           property_id, previous_assignee, next_assignee, reason,
           actor_user_id, occurred_at
         ) VALUES ($1, 2, 'org-inbox-command-revision', $2, NULL,
                   'manager-target', 'assign', 'manager-actor', NOW())`,
        [ITEM_ID, PROPERTY_ID],
      )

      const lostPromise = loser.query(
        `UPDATE inbox_items
         SET command_revision = command_revision + 1
         WHERE id = $1 AND command_revision = 1
         RETURNING command_revision`,
        [ITEM_ID],
      )
      await winner.query('COMMIT')
      const lost = await lostPromise
      expect(lost.rowCount).toBe(0)
      await loser.query('COMMIT')
    } finally {
      winner.release()
      loser.release()
    }

    const audit = await lease.pool.connect()
    try {
      await setFixtureSearchPath(audit)
      const triggers = await audit.query<{ tgname: string; tgenabled: string }>(`
        SELECT tgname, tgenabled
        FROM pg_trigger
        WHERE tgrelid = 'inbox_assignment_history'::regclass
          AND tgname IN (
            'inbox_assignment_history_immutable',
            'inbox_assignment_history_truncate_guard'
          )
        ORDER BY tgname
      `)
      expect(triggers.rows).toEqual([
        { tgname: 'inbox_assignment_history_immutable', tgenabled: 'A' },
        { tgname: 'inbox_assignment_history_truncate_guard', tgenabled: 'A' },
      ])

      const consistency = await audit.query<{
        item_revision: string
        history_revision: string
      }>(
        `
        SELECT i.command_revision::text AS item_revision,
               h.resulting_command_revision::text AS history_revision
        FROM inbox_items i
        JOIN inbox_assignment_history h ON h.inbox_item_id = i.id
        WHERE i.id = $1
      `,
        [ITEM_ID],
      )
      expect(consistency.rows).toEqual([{ item_revision: '2', history_revision: '2' }])

      // Expand safety: inbox_items.property_id is still a legacy varchar.
      // Eligibility loss must be able to advance the item fence and append
      // the exact retained key without a uuid cast rolling back the release.
      await audit.query('INSERT INTO inbox_items (id) VALUES ($1)', [LEGACY_ITEM_ID])
      await audit.query(
        `UPDATE inbox_items
         SET command_revision = command_revision + 1
         WHERE id = $1 AND command_revision = 1`,
        [LEGACY_ITEM_ID],
      )
      await audit.query(
        `INSERT INTO inbox_assignment_history (
           inbox_item_id, resulting_command_revision, organization_id,
           property_id, previous_assignee, next_assignee, reason,
           actor_user_id, occurred_at
         ) VALUES ($1, 2, 'org-inbox-command-revision', $2,
                   'manager-target', NULL, 'eligibility_lost',
                   'manager-actor', NOW())`,
        [LEGACY_ITEM_ID, LEGACY_PROPERTY_ID],
      )
      const legacyAudit = await audit.query<{ property_id: string }>(
        `SELECT property_id FROM inbox_assignment_history WHERE inbox_item_id = $1`,
        [LEGACY_ITEM_ID],
      )
      expect(legacyAudit.rows).toEqual([{ property_id: LEGACY_PROPERTY_ID }])

      for (const mutation of [
        `UPDATE inbox_assignment_history SET next_assignee = 'changed'`,
        `DELETE FROM inbox_assignment_history`,
        `TRUNCATE inbox_assignment_history`,
      ]) {
        await audit.query('BEGIN')
        await expect(audit.query(mutation)).rejects.toThrow('immutable')
        await audit.query('ROLLBACK')
      }

      // Aggregate lifecycle deletion is the sole delete path: the parent FK
      // cascade may remove its history, while a direct history delete above
      // remains rejected even for the table owner.
      await audit.query('DELETE FROM inbox_items WHERE id = $1', [ITEM_ID])
      const remainingHistory = await audit.query(
        'SELECT 1 FROM inbox_assignment_history WHERE inbox_item_id = $1',
        [ITEM_ID],
      )
      expect(remainingHistory.rowCount).toBe(0)
    } finally {
      audit.release()
    }
  })
})
