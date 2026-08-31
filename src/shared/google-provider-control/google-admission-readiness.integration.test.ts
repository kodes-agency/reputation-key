import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { createPostgresGoogleAdmissionPermitAuthority } from '../../../services/google-execution-admission/postgres-permit-authority'

let pool: Pool

beforeAll(() => {
  pool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 1_000,
    options:
      '-c lock_timeout=1s -c statement_timeout=3s -c idle_in_transaction_session_timeout=5s',
  })
})

afterAll(async () => {
  await pool?.end()
})

describe('Google admission database role readiness', () => {
  it('rejects an overprivileged primary-database owner', async () => {
    const authority = createPostgresGoogleAdmissionPermitAuthority({
      pool,
      gatewayIdentity: 'spiffe://repkey.internal/google-egress-gateway',
      releaseSha: 'a'.repeat(40),
    })

    await expect(authority.readiness()).resolves.toBe(false)
  })
})
