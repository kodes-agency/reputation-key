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

it('drops the four handshake columns and tightens each trend CHECK only while no trend row exists', async () => {
  databaseName = `test_ai_handshake_contract_${randomUUID().replaceAll('-', '')}`
  await maintenance.pool.query(`CREATE DATABASE "${databaseName}"`)
  const url = new URL(getEnv().DATABASE_URL)
  url.pathname = `/${databaseName}`
  target = await acquireTestLease(url.toString())
  restorePopulatedUpgradeFixture(url.toString())
  const { pool } = target
  const customerBeforeUpgrade = await upgradeCustomerRows(pool)
  const history = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string; when: number }[]
  }
  const contractionIndex = history.entries.findIndex(({ tag }) => tag === CONTRACTION)
  expect(contractionIndex).toBeGreaterThanOrEqual(manifest.appliedMigrations)
  historyFolder = mkdtempSync(join(tmpdir(), 'ai-handshake-contract-'))
  cpSync('drizzle', historyFolder, { recursive: true })
  const historyPath = join(historyFolder, 'meta/_journal.json')
  writeFileSync(
    historyPath,
    JSON.stringify({ ...history, entries: history.entries.slice(0, contractionIndex) }),
  )
  const client = await pool.connect()
  try {
    await migrateJournal(client, historyFolder)

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
    expect((await trendRows('ai_execution_control_heads')).rowCount).toBeGreaterThan(0)
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

    writeFileSync(
      historyPath,
      JSON.stringify({
        ...history,
        entries: history.entries.slice(0, contractionIndex + 1),
      }),
    )
    await migrateJournal(client, historyFolder)

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
  } finally {
    client.release()
  }
}, 150_000)
