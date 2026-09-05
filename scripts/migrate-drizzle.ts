import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MIGRATIONS_FOLDER = join(ROOT, 'drizzle')

async function main(): Promise<void> {
  loadEnv({ path: [join(ROOT, '.env.local'), join(ROOT, '.env')] })
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
    console.log('[db:migrate] drizzle track applied')
  } finally {
    await client.end()
  }
}

await main().catch((error: unknown) => {
  console.error('[db:migrate] FAILED', error)
  process.exitCode = 1
})
