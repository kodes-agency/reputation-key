// Migration 0053 against real PostgreSQL: an avatar or logo stored as an
// `amazonaws.com` address never loaded, so it is cleared and the UI falls back
// to initials. Anything else is left alone. The migration is hand-written SQL,
// run here against rows seeded in the shape the old finalize step stored.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const STATEMENTS = readFileSync(
  join(ROOT, 'drizzle', '0053_clear_legacy_asset_urls.sql'),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const KEY = `avatars/u1/${randomUUID()}`
const ASSET_PATH = `/api/public/identity-assets/${KEY}`
const CASES = [
  [
    'an AWS virtual-host address',
    `https://bucket.s3.eu-west-1.amazonaws.com/${KEY}`,
    null,
  ],
  ['an AWS path-style address', `https://s3.eu-west-1.amazonaws.com/bucket/${KEY}`, null],
  [
    'an AWS address in upper case',
    `HTTPS://BUCKET.S3.EU-WEST-1.AMAZONAWS.COM/${KEY}`,
    null,
  ],
  ['a path on the app', ASSET_PATH, ASSET_PATH],
  [
    'a picture hosted elsewhere',
    'https://cdn.example.com/me.png',
    'https://cdn.example.com/me.png',
  ],
  [
    'a host that only mentions AWS',
    'https://amazonaws.com.evil.example/me.png',
    'https://amazonaws.com.evil.example/me.png',
  ],
  ['no picture', null, null],
] as const

let lease: TestLease
const suffix = randomUUID()
const ids = CASES.map((_c, index) => `legacy-url-${index}-${suffix}`)

const runMigration = async (): Promise<void> => {
  for (const statement of STATEMENTS) await lease.pool.query(statement)
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  for (const [index, [, stored]] of CASES.entries()) {
    const id = ids[index]!
    await lease.pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
       VALUES ($1, 'Legacy URL', $2, true, $3, now(), now())`,
      [id, `${id}@example.test`, stored],
    )
    await lease.pool.query(
      `INSERT INTO organization (id, name, slug, logo, "createdAt")
       VALUES ($1, 'Legacy URL', $1, $2, now())`,
      [id, stored],
    )
  }
})

afterAll(async () => {
  await lease.pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [ids])
  await deleteTestOrganizations(lease.pool, ids)
  await lease.release()
})

describe('migration 0053 (clear legacy asset URLs)', () => {
  it.each(CASES.map((c, index) => [...c, index] as const))(
    'for %s, leaves the user image and the organization logo as expected',
    async (_label, _stored, expected, index) => {
      await runMigration()

      const id = ids[index]!
      const user = await lease.pool.query<{ image: string | null }>(
        `SELECT image FROM "user" WHERE id = $1`,
        [id],
      )
      const org = await lease.pool.query<{ logo: string | null }>(
        `SELECT logo FROM organization WHERE id = $1`,
        [id],
      )
      expect(user.rows[0]?.image).toBe(expected)
      expect(org.rows[0]?.logo).toBe(expected)
    },
  )

  it('is idempotent', async () => {
    await runMigration()
    await runMigration()

    const result = await lease.pool.query<{ count: string }>(
      `SELECT count(*) FROM "user" WHERE id = ANY($1) AND image ~* 'amazonaws[.]com/'`,
      [ids],
    )
    expect(Number(result.rows[0]?.count)).toBe(0)
  })
})
