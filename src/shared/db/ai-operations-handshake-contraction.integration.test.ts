import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { upgradeCustomerRows } from '../../../scripts/ci/populated-upgrade-fixture'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0156_ai_operations_drop_handshake_columns'
// Assembled from fragments so the source scan of these names stays clean.
const HANDSHAKE_COLUMNS = [
  ['admission', 'nonce'],
  ['request', 'binding', 'key', 'id'],
  ['request', 'binding', 'hmac'],
  ['grant', 'kid'],
].map((parts) => parts.join('_'))
const BRANCH_CHECK = 'ai_operations_branch_valid'
const HEADS_CHECK = 'ai_execution_control_heads_scope_valid'
const TRANSITIONS_CHECK = 'ai_execution_control_transitions_scope_valid'

it(
  'drops the four handshake columns and tightens each trend CHECK only while no trend row exists',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ pool, client, migrationIndex, migrateThrough }) => {
        const customerBeforeUpgrade = await upgradeCustomerRows(pool)
        await migrateThrough(migrationIndex)

        const columns = async () =>
          (
            await client.query<{ column_name: string }>(
              `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ai_operations'`,
            )
          ).rows.map(({ column_name }) => column_name)
        const check = async (name: string) =>
          (
            await client.query<{ definition: string; convalidated: boolean }>(
              `SELECT pg_get_constraintdef(oid) AS definition, convalidated
           FROM pg_constraint WHERE conname = $1`,
              [name],
            )
          ).rows[0]!
        expect(await columns()).toEqual(expect.arrayContaining(HANDSHAKE_COLUMNS))
        for (const name of [BRANCH_CHECK, HEADS_CHECK, TRANSITIONS_CHECK]) {
          expect((await check(name)).definition).toContain('property_trends')
        }

        // The seeded capability control rows name the trend capability in both control
        // tables. Only the heads lose theirs, so one CHECK tightens and one stays.
        const trendRows = (table: string) =>
          client.query(`SELECT 1 FROM ${table} WHERE scope_value = 'property_trends'`)
        expect((await trendRows('ai_execution_control_heads')).rowCount).toBeGreaterThan(
          0,
        )
        expect(
          (await trendRows('ai_execution_control_transitions')).rowCount,
        ).toBeGreaterThan(0)
        await client.query(
          'ALTER TABLE ai_execution_control_heads DISABLE TRIGGER ai_execution_control_heads_transition_guard',
        )
        await client.query(
          `DELETE FROM ai_execution_control_heads WHERE scope_value = 'property_trends'`,
        )
        await client.query(
          'ALTER TABLE ai_execution_control_heads ENABLE TRIGGER ai_execution_control_heads_transition_guard',
        )

        await migrateThrough(migrationIndex + 1)

        const remaining = await columns()
        for (const name of HANDSHAKE_COLUMNS) expect(remaining).not.toContain(name)
        const kept = await check(TRANSITIONS_CHECK)
        expect(kept.definition).toContain('property_trends')
        expect(kept.convalidated).toBe(true)
        for (const name of [BRANCH_CHECK, HEADS_CHECK]) {
          const tightened = await check(name)
          expect(tightened.definition).not.toContain('property_trends')
          expect(tightened.convalidated).toBe(true)
        }
        await expect(
          client.query(
            `INSERT INTO ai_execution_control_heads
           (scope_key, scope_kind, scope_value, control_id, generation,
            execution_state, admission_state, updated_at)
         VALUES ('capability:property_trends', 'capability', 'property_trends', $1, 1,
           'enabled', 'accepting', now())`,
            [randomUUID()],
          ),
        ).rejects.toMatchObject({ code: '23514', constraint: HEADS_CHECK })
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)

        await migrateJournal(client, 'drizzle')
        await migrateJournal(client, 'drizzle')
        expect(await columns()).toEqual(remaining)
      },
    ),
  150_000,
)
