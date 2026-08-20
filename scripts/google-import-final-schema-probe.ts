import { Pool } from 'pg'
import { probeFinalGoogleImportSchema } from '../src/shared/db/google-import-final-schema-probe'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 5_000,
})

try {
  const result = await probeFinalGoogleImportSchema(pool)
  console.log(JSON.stringify(result))
} finally {
  await pool.end()
}
