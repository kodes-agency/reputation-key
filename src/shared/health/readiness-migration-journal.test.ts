// BQC-7.2 — the real migration-journal probe behind /api/health/ready and
// /api/health/started, against the journal this checkout carries and a faked
// applied count. readiness.test.ts covers the assembly with fake probes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), warn: vi.fn() }))

vi.mock('#/shared/db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/db/pool')>()),
  getPool: () => ({ query: mocks.query }),
}))

vi.mock('#/shared/observability/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/observability/logger')>()),
  getLogger: () => ({ warn: mocks.warn }),
}))

import { MIGRATION_COUNT_SQL } from './migration-version'
import { isMigrationJournalMatched } from './readiness'

const journalEntries = (
  JSON.parse(
    readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: readonly unknown[] }
).entries.length

function applied(count: number): void {
  mocks.query.mockResolvedValueOnce({ rows: [{ count }] })
}

describe('isMigrationJournalMatched', () => {
  beforeEach(() => {
    mocks.query.mockReset()
    mocks.warn.mockReset()
  })

  it('is ready when the database applied exactly the image journal', async () => {
    applied(journalEntries)

    await expect(isMigrationJournalMatched()).resolves.toBe(true)
    expect(mocks.query).toHaveBeenCalledWith(MIGRATION_COUNT_SQL)
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('is not ready, and says nothing more, while migrations are still applying', async () => {
    applied(journalEntries - 1)

    await expect(isMigrationJournalMatched()).resolves.toBe(false)
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('is never ready on an image older than the database, and says that is by design', async () => {
    applied(journalEntries + 1)

    await expect(isMigrationJournalMatched()).resolves.toBe(false)
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { applied: journalEntries + 1, journalEntries },
      '[health] this image is older than the database — more migrations are applied than its journal holds, ' +
        'so it is never ready by design (forward-only recovery, ADR 0038). ' +
        'Expected on the outgoing container while a newer release deploys',
    )
  })

  it('is not ready when the applied count cannot be read', async () => {
    const failure = new Error('relation "drizzle.__drizzle_migrations" does not exist')
    mocks.query.mockRejectedValueOnce(failure)

    await expect(isMigrationJournalMatched()).resolves.toBe(false)
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { err: failure },
      '[health] migration journal check failed',
    )
  })
})
