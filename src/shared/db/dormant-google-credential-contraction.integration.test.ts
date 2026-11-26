import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { upgradeCustomerRows } from '../../../scripts/ci/populated-upgrade-fixture'
import manifest from '../../../test-fixtures/populated-upgrade/manifest.json'
import { migrateJournal } from './migrate-journal.server'
import { withDatabaseBeforeMigration } from '#/shared/testing/database-before-migration'

const CONTRACTION = '0120_drop_dormant_google_credentials'
const TABLES = [
  'credential_revoke_permits',
  'google_credential_source_operations',
  'google_subject_authority_guards',
] as const

it(
  'refuses every populated credential table atomically, then contracts only empty tables and preserves Disconnect receipts',
  () =>
    withDatabaseBeforeMigration(
      CONTRACTION,
      async ({ pool, client, entries, migrationIndex, migrateThrough }) => {
        const customerBeforeUpgrade = await upgradeCustomerRows(pool)
        await migrateThrough(migrationIndex)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)

        const permitId = randomUUID()
        const guardId = randomUUID()
        const sourceId = randomUUID()
        const revokeId = randomUUID()
        const receiptId = randomUUID()
        await client.query(
          `INSERT INTO authorization_execution_permits (
        id, capability, organization_id, operation_key, route_key,
        route_catalog_version, quota_policy_id, authorization_vector,
        state, admitted_at, start_deadline_at
      ) VALUES ($1, 'property.import_gbp_v2', $2, 'refresh', 'oauth.token.refresh',
        'contract-test', 'contract-test', '{}', 'admitted', now(), now() + interval '1 minute')`,
          [permitId, manifest.organizationIds[0]],
        )
        await client.query(
          `INSERT INTO google_subject_authority_guards (
        id, project_client_hmac_key_version, project_client_hmac,
        subject_hmac_key_version, subject_hmac
      ) VALUES ($1, 'v1', $2, 'v1', $3)`,
          [guardId, randomUUID(), randomUUID()],
        )
        await client.query(
          `INSERT INTO google_credential_source_operations (
        id, guard_id, source_work_permit_id, organization_id, sequence,
        kind, state, expected_lifecycle_version, expected_access_version,
        expected_credential_generation, operation_deadline_at
      ) VALUES ($1, $2, $3, $4, 1, 'refresh', 'registered', 1, 1, 1,
        now() + interval '1 minute')`,
          [sourceId, guardId, permitId, manifest.organizationIds[0]],
        )
        await client.query(
          `INSERT INTO credential_revoke_permits (
        id, guard_id, source_operation_id, state, cleanup_deadline_at
      ) VALUES ($1, $2, $3, 'dormant', now() + interval '1 minute')`,
          [revokeId, guardId, sourceId],
        )
        await client.query(
          `INSERT INTO idempotency_receipts (scope, key, payload)
       VALUES ('google_disconnect_revoke', $1, $2::jsonb)`,
          [
            receiptId,
            JSON.stringify({
              id: receiptId,
              organizationId: manifest.organizationIds[0],
              state: 'dispatching',
              terminalAt: null,
            }),
          ],
        )

        const tables = async () =>
          (
            await client.query<{ tablename: string }>(
              `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
            )
          ).rows.map(({ tablename }) => tablename)
        const enums = async () =>
          (
            await client.query(
              `SELECT t.typname, e.enumlabel, e.enumsortorder
           FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' ORDER BY t.typname, e.enumsortorder`,
            )
          ).rows
        const journal = async () =>
          (
            await client.query(
              'SELECT hash, created_at, is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at',
            )
          ).rows
        const receipts = async () =>
          (
            await client.query(
              `SELECT * FROM idempotency_receipts
           WHERE scope = 'google_disconnect_revoke' ORDER BY key`,
            )
          ).rows
        const legacyRows = async () => {
          const snapshots: unknown[][] = []
          for (const table of TABLES) {
            // These fixed names are the three objects authorized for contraction.
            const result = await client.query(`SELECT * FROM ${table} ORDER BY id`)
            snapshots.push(result.rows)
          }
          return snapshots
        }
        const beforeTables = await tables()
        const beforeEnums = await enums()
        const beforeJournal = await journal()
        const beforeReceipts = await receipts()

        // Child-first cases keep every foreign key valid while exercising a row in
        // each table, including a parent that has no remaining dependent rows.
        for (const table of TABLES) {
          const beforeRows = await legacyRows()
          await expect(migrateJournal(client, 'drizzle')).rejects.toThrow(table)
          expect(await tables()).toEqual(beforeTables)
          expect(await legacyRows()).toEqual(beforeRows)
          expect(await journal()).toEqual(beforeJournal)
          expect(await receipts()).toEqual(beforeReceipts)
          expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
          await client.query(`DELETE FROM ${table}`)
        }

        // Later contractions have their own proofs; stop after this one.
        await migrateThrough(migrationIndex + 1)
        expect(await tables()).toEqual(
          beforeTables.filter((table) => !TABLES.some((removed) => removed === table)),
        )
        expect(await enums()).toEqual(beforeEnums)
        expect(await receipts()).toEqual(beforeReceipts)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
        const applied = await journal()
        expect(applied).toHaveLength(migrationIndex + 1)
        expect(applied[migrationIndex]).toMatchObject({
          created_at: String(entries[migrationIndex]!.when),
          is_contract: true,
        })
        await migrateThrough(migrationIndex + 1)
        expect(await journal()).toEqual(applied)
        expect(await receipts()).toEqual(beforeReceipts)
        expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
      },
    ),
  150_000,
)
