import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'
import { runStagedDrizzleMigrations } from '../src/shared/db/staged-drizzle-migrator'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MIGRATIONS_FOLDER = join(ROOT, 'drizzle')

async function main(): Promise<void> {
  loadEnv({ path: [join(ROOT, '.env.local'), join(ROOT, '.env')] })
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const result = await runStagedDrizzleMigrations(client, MIGRATIONS_FOLDER)
    console.log(`[db:migrate] staged drizzle track ${JSON.stringify(result)}`)
  } finally {
    await client.end()
  }
}

await main().catch((error: unknown) => {
  console.error('[db:migrate] FAILED', error)
  process.exitCode = 1
})
