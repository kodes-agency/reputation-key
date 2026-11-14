import { Pool } from 'pg'
import { randomBytes } from 'node:crypto'
import { testEnvironment } from '../../src/shared/testing/test-environment'
import { createTokenEncryptionAdapter } from '../../src/contexts/integration/infrastructure/adapters/token-encryption.adapter'

/**
 * Unique-per-run marker for every fixture-created external identifier.
 *
 * Playwright workers fork together, so the millisecond prefix routinely ties
 * and the suffix is the only thing separating two workers. The suffix was
 * `Math.floor(Math.random() * 1296).toString(36)`: 1296 values, and only ONE
 * character whenever the draw landed below 36, so the id was not even a fixed
 * width. Two random bytes give a uniform 4 characters and 65536 values. A tie
 * here does not fail as a tie — it surfaces as an unrelated unique-constraint
 * violation in whichever spec loses the race, which is why it is worth the
 * widening rather than the explanation.
 */
export const e2eRunId = `r${Date.now().toString(36)}${randomBytes(2).toString('hex')}`

export const TEST_ENV = testEnvironment()

// ── DB access ─────────────────────────────────────────────────────────

let _pool: Pool | undefined

function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: TEST_ENV.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 10_000,
      // Let the Playwright worker process exit when the suite is done even
      // though the pool is never explicitly closed.
      allowExitOnIdle: true,
    })
  }
  return _pool
}

export async function dbQuery<T = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool().query(text, params as unknown[])
  return result.rows as T[]
}

// ── Token encryption ──────────────────────────────────────────────────

/**
 * Encrypt through the PRODUCTION adapter, never a copy of it.
 *
 * This helper used to reimplement AES-256-GCM under a comment reading "must
 * match token-encryption.adapter.ts". It stopped matching the moment the
 * adapter added its version prefix, and the only thing that noticed was the
 * critical e2e gate, which failed inside a server function with `Invalid
 * ciphertext format` — a fixture bug wearing a product bug's clothes.
 * A format has exactly one definition; a second one is a latent outage.
 */
export function encryptToken(plaintext: string): string {
  return createTokenEncryptionAdapter({
    activeVersion: 'v1',
    keys: { v1: TEST_ENV.ENCRYPTION_KEY },
  }).encrypt(plaintext)
}
