import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  restorePopulatedUpgradeFixture,
  upgradeCustomerRows,
} from '../../../scripts/ci/populated-upgrade-fixture'
import manifest from '../../../test-fixtures/populated-upgrade/manifest.json'
import { migrateJournal } from './migrate-journal.server'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'

const CONTRACTION = '0124_drop_old_google_import_tables'
const TABLES = [
  'gbp_import_request_items',
  'gbp_import_requests',
  'gbp_import_sagas',
] as const
const DIGEST = 'D'.repeat(43)

let maintenance: TestLease
let target: TestLease | undefined
let databaseName: string | undefined
let historyFolder: string | undefined

beforeAll(async () => {
  maintenance = await acquireTestLease(getEnv().DATABASE_URL)
})

afterAll(async () => {
  await target?.release()
  if (databaseName) await maintenance.pool.query(`DROP DATABASE "${databaseName}"`)
  await maintenance?.release()
  if (historyFolder) rmSync(historyFolder, { recursive: true, force: true })
})

it('refuses to drop the old import tables while a row is active, then drops them and the enum only they used', async () => {
  databaseName = `test_google_import_contract_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`)
  const url = new URL(getEnv().DATABASE_URL)
  url.pathname = `/${databaseName}`
  target = await acquireTestLease(url.toString())
  restorePopulatedUpgradeFixture(url.toString())
  const { pool } = target
  const customerBeforeUpgrade = await upgradeCustomerRows(pool)

  // Stop immediately before the real contraction, using the deployment runner.
  const history = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string; when: number }[]
  }
  const contractionIndex = history.entries.findIndex(({ tag }) => tag === CONTRACTION)
  expect(contractionIndex).toBeGreaterThanOrEqual(manifest.appliedMigrations)
  historyFolder = mkdtempSync(join(tmpdir(), 'google-import-contract-'))
  cpSync('drizzle', historyFolder, { recursive: true })
  writeFileSync(
    join(historyFolder, 'meta/_journal.json'),
    JSON.stringify({ ...history, entries: history.entries.slice(0, contractionIndex) }),
  )
  const client = await pool.connect()
  try {
    await migrateJournal(client, historyFolder)
    expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)

    const property = (
      await client.query<{ id: string; organization_id: string }>(
        'SELECT id, organization_id FROM properties ORDER BY id LIMIT 1',
      )
    ).rows[0]!
    const connectionId = randomUUID()
    const sagaId = randomUUID()
    const requestId = randomUUID()
    const itemId = randomUUID()
    const now = new Date()
    await seedGoogleConnection(client, {
      id: connectionId,
      organizationId: property.organization_id,
      googleSubject: 'contract-subject',
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(now.getTime() + 3_600_000),
      connectedBy: 'contract-test',
      credentialAuthorizedBy: 'contract-test',
      credentialAuthorizedAt: now,
      lastSuccessfulSyncAt: now,
      statusReason: 'connected',
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await client.query(
      `INSERT INTO gbp_import_sagas (
         id, organization_id, request_id, initiated_by, total_count, batch_count,
         wire_replay_key_version, wire_replay_digest,
         semantic_replay_key_version, semantic_replay_digest, created_at, updated_at
       ) VALUES ($1, $2, $3, 'contract-test', 1, 1, 'wire_v1', $4, 'semantic_v1', $4, $5, $5)`,
      [sagaId, property.organization_id, randomUUID(), DIGEST, now],
    )
    await client.query(
      `INSERT INTO gbp_import_requests (
         id, organization_id, request_id, initiated_by, saga_id, batch_ordinal,
         status, total_count, processed_count, pending_count,
         wire_replay_key_version, wire_replay_digest,
         semantic_replay_key_version, semantic_replay_digest, created_at, updated_at
       ) VALUES ($1, $2, $3, 'contract-test', $4, 0, 'processing', 1, 0, 1,
                 'wire_v1', $5, 'semantic_v1', $5, $6, $6)`,
      [requestId, property.organization_id, randomUUID(), sagaId, DIGEST, now],
    )
    await client.query(
      `INSERT INTO gbp_import_request_items (
         id, organization_id, import_job_id, connection_id,
         destination_property_id, provider_account_suffix,
         provider_location_suffix, expected_connection_lifecycle_version,
         expected_connection_access_version, expected_credential_generation,
         action, update_existing_profile, property_name, country_code, timezone,
         status, effect_deadline_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'account', 'location', 1, 1, 1,
                 'create', true, 'Imported Location', 'US', 'UTC',
                 'pending', $6, $7, $7)`,
      [
        itemId,
        property.organization_id,
        requestId,
        connectionId,
        property.id,
        new Date(now.getTime() + 86_400_000),
        now,
      ],
    )

    const tables = async () =>
      (
        await client.query<{ tablename: string }>(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        )
      ).rows.map(({ tablename }) => tablename)
    const types = async () =>
      (
        await client.query<{ typname: string }>(
          `SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND typname LIKE 'google_import_v2_%'
           ORDER BY typname`,
        )
      ).rows.map(({ typname }) => typname)
    const journal = async () =>
      (
        await client.query(
          'SELECT hash, created_at, is_contract FROM drizzle.__drizzle_migrations ORDER BY created_at',
        )
      ).rows
    const oldRows = async () => {
      const snapshots: unknown[][] = []
      for (const table of TABLES) {
        // These fixed names are the objects authorized for contraction.
        const result = await client.query(`SELECT * FROM ${table} ORDER BY id`)
        snapshots.push(result.rows)
      }
      return snapshots
    }
    const beforeTables = await tables()
    const beforeTypes = await types()
    const beforeJournal = await journal()
    expect(beforeTypes).toContain('google_import_v2_parent_status')

    const expectRefusal = async (message: string) => {
      const beforeRows = await oldRows()
      await expect(migrateJournal(client, 'drizzle')).rejects.toThrow(message)
      expect(await tables()).toEqual(beforeTables)
      expect(await types()).toEqual(beforeTypes)
      expect(await oldRows()).toEqual(beforeRows)
      expect(await journal()).toEqual(beforeJournal)
      expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
    }

    // A pending item stops the whole migration, then so does a processing root.
    await expectRefusal(
      'Cannot drop gbp_import_request_items: 1 rows are pending or processing',
    )
    await client.query(
      `UPDATE gbp_import_request_items
       SET status = 'imported', outcome_code = 'imported', first_terminal_at = $2,
           updated_at = $2 WHERE id = $1`,
      [itemId, now],
    )
    await expectRefusal(
      'Cannot drop gbp_import_requests: 1 rows are queued or processing',
    )

    // Finished history does not block the drop.
    await client.query(
      `UPDATE gbp_import_requests
       SET status = 'completed', processed_count = 1, pending_count = 0,
           imported_count = 1, first_terminal_at = $2,
           purge_at = $2::timestamptz + interval '30 days', updated_at = $2
       WHERE id = $1`,
      [requestId, now],
    )

    // Apply only the contraction, so later additive migrations cannot change the table set.
    writeFileSync(
      join(historyFolder, 'meta/_journal.json'),
      JSON.stringify({
        ...history,
        entries: history.entries.slice(0, contractionIndex + 1),
      }),
    )
    await migrateJournal(client, historyFolder)
    expect(await tables()).toEqual(
      beforeTables.filter((table) => !TABLES.some((removed) => removed === table)),
    )
    // The item, action and outcome enums still type the current import tables.
    expect(await types()).toEqual(
      beforeTypes.filter((type) => type !== 'google_import_v2_parent_status'),
    )
    expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
    expect(await journal()).toHaveLength(contractionIndex + 1)

    await migrateJournal(client, 'drizzle')
    expect(await upgradeCustomerRows(pool)).toEqual(customerBeforeUpgrade)
    const applied = await journal()
    expect(applied).toHaveLength(history.entries.length)
    expect(applied[contractionIndex]).toMatchObject({
      created_at: String(history.entries[contractionIndex]!.when),
      is_contract: true,
    })
    await migrateJournal(client, 'drizzle')
    expect(await journal()).toEqual(applied)
  } finally {
    client.release()
  }
}, 150_000)
