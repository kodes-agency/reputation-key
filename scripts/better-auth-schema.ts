// Better Auth schema runner backed by the exact `better-auth` runtime pinned
// in package.json and pnpm-lock.yaml. Do not replace this with a separately
// fetched @better-auth/cli: its release line can lag the runtime and generate
// a schema for a different Better Auth version.

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import type { Pool } from 'pg'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

async function main(): Promise<void> {
  loadEnv({ path: [join(ROOT, '.env.local'), join(ROOT, '.env')] })

  // Deferred until after dotenv: auth-cli.ts intentionally validates the
  // migration secret while constructing the schema-authoritative auth config.
  const { auth } = await import('../src/shared/auth/auth-cli')
  const { getMigrations } = await import('better-auth/db/migration')
  const database = auth.options.database as Pool

  try {
    const migrations = await getMigrations(auth.options)
    const pendingTables = migrations.toBeCreated.length
    const pendingColumns = migrations.toBeAdded.reduce(
      (total, table) => total + Object.keys(table.fields).length,
      0,
    )

    if (pendingTables === 0 && pendingColumns === 0) {
      console.log('[better-auth-schema] Schema is up to date')
      return
    }

    await migrations.runMigrations()
    console.log(
      `[better-auth-schema] Applied ${pendingTables} table(s) and ${pendingColumns} column(s)`,
    )
  } finally {
    await database.end()
  }
}

await main()
