// BQC-7.2 — the real migration-journal probe behind /api/health/ready and
// /api/health/started, against the journal this checkout carries and a faked
// applied count. readiness.test.ts covers the assembly with fake probes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), warn: vi.fn() }))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) }
})

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
import {
  compatibilityJournal,
  previousJournal,
  previousRevisionReadiness,
} from './previous-revision-readiness.test-fixture'

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

  it('accepts a later expand for an image with compatibility support', async () => {
    applied(journalEntries + 1)

    await expect(isMigrationJournalMatched()).resolves.toBe(true)
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('keeps the actual previous revision ready through the compatibility release', async () => {
    const previousReady = previousRevisionReadiness(mocks.query)
    applied(previousJournal.entries.length)
    await expect(previousReady()).resolves.toBe(true)
    applied(compatibilityJournal.entries.length)
    await expect(previousReady()).resolves.toBe(true)
    expect(compatibilityJournal).toEqual(previousJournal)
    applied(compatibilityJournal.entries.length)
    vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(compatibilityJournal))
    await expect(isMigrationJournalMatched()).resolves.toBe(true)
  })

  it('keeps this image unready while only the released journal is applied', async () => {
    applied(previousJournal.entries.length)

    await expect(isMigrationJournalMatched()).resolves.toBe(false)
  })

  it('proves why migrations must follow the compatibility release', async () => {
    const previousReady = previousRevisionReadiness(mocks.query)
    applied(previousJournal.entries.length + 24)
    await expect(previousReady()).resolves.toBe(false)
    applied(previousJournal.entries.length + 24)
    await expect(isMigrationJournalMatched()).resolves.toBe(true)
  })

  it('ends compatibility when the database has applied a later contract', async () => {
    const journal = JSON.parse(
      readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: { when: number }[] }
    mocks.query.mockResolvedValueOnce({
      rows: [
        { count: journalEntries + 1, contract_when: journal.entries.at(-1)!.when + 1 },
      ],
    })

    await expect(isMigrationJournalMatched()).resolves.toBe(false)
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
