// Drop the database, create it empty, and bring it to the deploy migration
// state. This is the schema-change loop's second half:
//
//   edit src/shared/db/schema/*.ts  ->  pnpm db:baseline  ->  pnpm db:reset
//   ->  pnpm check:schema-drift
//
// It exists because the journal is regenerated rather than appended: a
// re-baselined journal cannot be applied on top of a database that already
// recorded the old entries, so the only correct move is to start empty.
//
// Destructive by design, so the target is guarded: localhost only, unless
// ALLOW_REMOTE_TEST_DB=1 says otherwise out loud.

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LOCAL_HOSTS: Record<string, true> = {
  localhost: true,
  '127.0.0.1': true,
  '::1': true,
  '': true,
}

function maintenanceUrl(url: URL): string {
  const maintenance = new URL(url.toString())
  maintenance.pathname = '/postgres'
  return maintenance.toString()
}

function assertLocalTarget(url: URL): void {
  if (LOCAL_HOSTS[url.hostname] === true || process.env.ALLOW_REMOTE_TEST_DB === '1')
    return
  throw new Error(
    `refusing to drop a non-local database (host ${url.hostname}). ` +
      'Set ALLOW_REMOTE_TEST_DB=1 only if you mean to destroy it.',
  )
}

async function recreate(url: URL, database: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl(url) })
  await client.connect()
  try {
    // Terminate stragglers first: a single idle psql or dev server holds the
    // database open and DROP DATABASE fails rather than waiting.
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [database],
    )
    await client.query(`DROP DATABASE IF EXISTS "${database}"`)
    await client.query(`CREATE DATABASE "${database}"`)
  } finally {
    await client.end()
  }
}

async function main(): Promise<void> {
  loadEnv({ path: [join(ROOT, '.env.local'), join(ROOT, '.env')] })
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is required')

  const url = new URL(raw)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!database) throw new Error(`DATABASE_URL names no database: ${url.pathname}`)
  assertLocalTarget(url)

  console.log(`[db:reset] recreating ${database} on ${url.hostname || 'socket'}`)
  await recreate(url, database)

  // The deploy runner is the only migration authority (README, Database
  // Migrations). It seeds the review provider-subject inventory on an empty
  // database, which needs the one-run sealed migrator key — generated here
  // because a disposable local database has no inventory to preserve.
  execFileSync('pnpm', ['db:migrate-deploy'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      DEPLOY_MIGRATE: '1',
      REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS:
        process.env.REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS ??
        `v1:${randomBytes(32).toString('hex')}`,
      REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: undefined,
    } as NodeJS.ProcessEnv,
  })

  console.log('[db:reset] done — next: pnpm check:schema-drift')
}

await main().catch((error: unknown) => {
  console.error('[db:reset] FAILED', error)
  process.exitCode = 1
})
