import { expect, it } from 'vitest'
import { upgradeCustomerRows } from '../../../scripts/ci/populated-upgrade-fixture'
import manifest from '../../../test-fixtures/populated-upgrade/manifest.json'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0130_drop_retired_account_tables'
const DROPPED = [
  'organizationRole',
  'organization_role_policy',
  'property_access_grants',
  'policy_consent',
  'property_erase_authorities',
  'privacy_requests',
  'organization_lifecycle_authority',
  'organization_exports',
  'organization_export_retrieval_issuances',
] as const
const ORGANIZATION = manifest.organizationIds[0]

it(
  'refuses an unexpected row or a closed Organization atomically, then drops the retired account tables and keeps the lifecycle events',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ pool, client, entries, migrationIndex, migrateThrough }) => {
        const customerBeforeUpgrade = await upgradeCustomerRows(pool)
        await migrateThrough(migrationIndex)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)

        const tables = async () =>
          (
            await client.query<{ tablename: string }>(
              `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
            )
          ).rows.map(({ tablename }) => tablename)
        const types = async () =>
          (
            await client.query<{ typname: string }>(
              `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY t.typname`,
            )
          ).rows.map(({ typname }) => typname)
        const journal = async () =>
          (
            await client.query(
              'SELECT hash, created_at, is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at',
            )
          ).rows
        const retiredRows = async () => {
          const snapshots: unknown[][] = []
          for (const table of DROPPED) {
            // These fixed names are the nine objects authorized for contraction.
            const result = await client.query(`SELECT * FROM "${table}" ORDER BY 1`)
            snapshots.push(result.rows)
          }
          return snapshots
        }
        const events = async () =>
          (await client.query('SELECT * FROM organization_lifecycle_events ORDER BY id'))
            .rows

        const authority = await client.query(
          'SELECT state, closed_at FROM organization_lifecycle_authority',
        )
        expect(authority.rows.length).toBeGreaterThan(0)
        expect(authority.rows.every((row) => row.state === 'active')).toBe(true)
        await client.query(
          `INSERT INTO organization_lifecycle_events (organization_id, context, phase, kind)
       VALUES ($1, 'identity', 'hold_release', 'backup_erasure_hold_release:contract-test')`,
          [ORGANIZATION],
        )
        const beforeTables = await tables()
        const beforeTypes = await types()
        const beforeJournal = await journal()
        const beforeEvents = await events()

        const refuses = async (table: string) => {
          const beforeRows = await retiredRows()
          await expect(migrateJournal(client, 'drizzle')).rejects.toThrow(table)
          expect(await tables()).toEqual(beforeTables)
          expect(await types()).toEqual(beforeTypes)
          expect(await retiredRows()).toEqual(beforeRows)
          expect(await journal()).toEqual(beforeJournal)
          expect(await events()).toEqual(beforeEvents)
          expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        }

        // An unexpected row in any retired table makes the migration refuse.
        await client.query(
          `INSERT INTO policy_consent (organization_id, subject_type, subject_id, purpose)
       VALUES ($1, 'organization', $1, 'contract-test')`,
          [ORGANIZATION],
        )
        await refuses('policy_consent')
        await client.query('DELETE FROM policy_consent')
        await client.query(
          `INSERT INTO organization_role_policy (organization_id, role, data_scope)
       VALUES ($1, 'contract-test', 'none')`,
          [ORGANIZATION],
        )
        await refuses('organization_role_policy')
        await client.query('DELETE FROM organization_role_policy')

        // An Organization that is not in the active state keeps its authority row.
        await client.query(
          'ALTER TABLE organization_lifecycle_authority DISABLE TRIGGER USER',
        )
        await client.query(
          'ALTER TABLE organization_lifecycle_authority DROP CONSTRAINT organization_lifecycle_state_shape',
        )
        await client.query(
          `UPDATE organization_lifecycle_authority SET state = 'closing'
       WHERE organization_id = $1`,
          [ORGANIZATION],
        )
        await refuses('organization_lifecycle_authority')
        await client.query(
          `UPDATE organization_lifecycle_authority SET state = 'active'
       WHERE organization_id = $1`,
          [ORGANIZATION],
        )

        // Later contractions have their own proofs; stop after this one.
        await migrateThrough(migrationIndex + 1)
        expect(await tables()).toEqual(
          beforeTables.filter((table) => !DROPPED.some((removed) => removed === table)),
        )
        expect(await types()).toEqual(
          beforeTypes.filter((type) => type !== 'grant_kind' && type !== 'grant_status'),
        )
        expect(await events()).toEqual(beforeEvents)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        const applied = await journal()
        expect(applied).toHaveLength(migrationIndex + 1)
        expect(applied[migrationIndex]).toMatchObject({
          created_at: String(entries[migrationIndex]!.when),
          is_contract: true,
        })

        // A new Organization no longer needs a lifecycle row.
        await client.query(
          `INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org-after-contract', 'After', 'after-contract', now())`,
        )
        await client.query(`DELETE FROM organization WHERE id = 'org-after-contract'`)

        await migrateThrough(migrationIndex + 1)
        expect(await journal()).toEqual(applied)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
      },
    ),
  150_000,
)
