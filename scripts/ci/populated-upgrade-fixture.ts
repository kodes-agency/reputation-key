import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { Pool } from 'pg'
import manifest from '../../test-fixtures/populated-upgrade/manifest.json'

/** Verify the captured bytes before handing the dump to psql. */
export function readPopulatedUpgradeFixture(archive: Buffer): string {
  if (createHash('sha256').update(archive).digest('hex') !== manifest.sha256Gzip) {
    throw new Error('Populated upgrade fixture digest differs from the pinned archive')
  }
  const sql = gunzipSync(archive)
  if (createHash('sha256').update(sql).digest('hex') !== manifest.sha256Sql) {
    throw new Error('Populated upgrade fixture digest differs from the pinned SQL')
  }
  // The pinned dump is trusted; older psql clients do not know these commands.
  return sql.toString('utf8').replace(/^\\(?:un)?restrict\b[^\r\n]*(?:\r?\n|$)/gm, '')
}

/** Caller must hold a disposable database lease before restoring. */
export function restorePopulatedUpgradeFixture(databaseUrl: string): void {
  const url = new URL(databaseUrl)
  const password = decodeURIComponent(url.password)
  url.password = ''
  const input = readPopulatedUpgradeFixture(
    readFileSync('test-fixtures/populated-upgrade/two-tenant.sql.gz'),
  )
  execFileSync(
    'psql',
    [
      '--no-psqlrc',
      '--quiet',
      '--single-transaction',
      '--set',
      'ON_ERROR_STOP=1',
      '--dbname',
      url.toString(),
    ],
    {
      input,
      env: { ...process.env, PGPASSWORD: password },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  )
}

export async function upgradeCustomerRows(pool: Pool): Promise<unknown[][]> {
  // Stable identities, tenant edges and customer work survive schema evolution.
  const selects = [
    'SELECT id, name, slug FROM organization ORDER BY id',
    'SELECT id, organization_id, name FROM properties ORDER BY id',
    'SELECT id, organization_id, property_id, name FROM portals ORDER BY id',
    'SELECT id, organization_id, property_id, external_id FROM reviews ORDER BY id',
    'SELECT id, organization_id, review_id, text, status FROM replies ORDER BY id',
    'SELECT id, organization_id, property_id, portal_id, rating FROM guest_responses ORDER BY id',
  ]
  return Promise.all(selects.map(async (query) => (await pool.query(query)).rows))
}
