import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { createPostgresAiAdmissionAuthority } from '../../services/ai-execution-admission/postgres-admission-authority'

let pool: Pool

beforeAll(() => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
  pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 1_000,
    options:
      '-c lock_timeout=1s -c statement_timeout=3s -c idle_in_transaction_session_timeout=5s',
  })
})

afterAll(async () => {
  await pool?.end()
})

describe('AI admission database role readiness', () => {
  it('rejects an overprivileged primary-database owner', async () => {
    const authority = createPostgresAiAdmissionAuthority({
      pool,
      signingKid: 'grant-v1',
    })
    await expect(authority.readiness()).resolves.toBe(false)
  })
})
