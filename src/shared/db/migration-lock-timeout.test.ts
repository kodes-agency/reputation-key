import { describe, expect, it } from 'vitest'
import {
  boundMigrationLockWait,
  isMigrationLockTimeout,
  MIGRATION_LOCK_TIMEOUT_MS,
  withMigrationLockTimeout,
} from './migration-lock-timeout'
import { SESSION_LOCK_TIMEOUT_MS } from './pool'

function recordingSession() {
  const statements: string[] = []
  return {
    statements,
    session: {
      query: async (text: string) => {
        statements.push(text)
        return { rows: [] }
      },
    },
  }
}

describe('boundMigrationLockWait', () => {
  // The Better Auth track's pool calls this for each connection it opens and
  // never lifts it: those sessions only manage schema.
  it('sets the bound on the session and leaves it there', async () => {
    const { session, statements } = recordingSession()

    await boundMigrationLockWait(session)

    expect(statements).toEqual(['SET lock_timeout = 5000'])
  })
})

describe('withMigrationLockTimeout', () => {
  it('bounds the lock wait for the journal and lifts the bound afterwards', async () => {
    const { session, statements } = recordingSession()

    const applied = await withMigrationLockTimeout(session, async () => {
      statements.push('apply journal')
      return 'applied'
    })

    expect(applied).toBe('applied')
    // The concurrent-index sidecar runs next on this session and may wait for
    // an old transaction far longer than a migration may wait for a lock.
    expect(statements).toEqual([
      'SET lock_timeout = 5000',
      'apply journal',
      'RESET lock_timeout',
    ])
  })

  it('leaves the bound in place when the journal fails, and reports that failure', async () => {
    const { session, statements } = recordingSession()
    const failure = new Error('canceling statement due to lock timeout')

    await expect(
      withMigrationLockTimeout(session, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)

    // The runner reads the journal state next, on the same session: still
    // bounded, so it cannot hang on the lock that failed the journal.
    expect(statements).toEqual(['SET lock_timeout = 5000'])
  })

  it('gives up before an application session queued behind it would', () => {
    expect(MIGRATION_LOCK_TIMEOUT_MS).toBeLessThan(SESSION_LOCK_TIMEOUT_MS)
  })
})

describe('isMigrationLockTimeout', () => {
  const lockTimeout = Object.assign(
    new Error('canceling statement due to lock timeout'),
    { code: '55P03' },
  )

  it('recognises the PostgreSQL error and the query error that wraps it', () => {
    expect(isMigrationLockTimeout(lockTimeout)).toBe(true)
    expect(
      isMigrationLockTimeout(
        new Error('Failed query: ALTER TABLE', { cause: lockTimeout }),
      ),
    ).toBe(true)
  })

  it('is false for any other failure', () => {
    expect(isMigrationLockTimeout(new Error('relation "reviews" already exists'))).toBe(
      false,
    )
    expect(
      isMigrationLockTimeout(Object.assign(new Error('deadlock'), { code: '40P01' })),
    ).toBe(false)
    expect(isMigrationLockTimeout('connection refused')).toBe(false)
    expect(isMigrationLockTimeout(null)).toBe(false)
  })
})
