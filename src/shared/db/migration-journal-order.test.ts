// The migration journal is appended by hand: `idx`, `when` and the entry's
// place in the array are typed, not generated (drizzle/meta holds snapshots only
// up to 0013, so `drizzle-kit generate` is not a usable author). drizzle applies
// an entry only when its `when` is greater than the newest applied row's
// `created_at`, so a new entry whose `when` does not rise above its predecessor
// is applied on an empty database and skipped on one that already ran the
// predecessor. CI migrates an empty database; the deployed one is not empty.
//
// Measured before this check existed, with a probe entry appended to the real
// journal: a `when` BELOW the predecessor already failed the schema drift step
// (the applied rows sort differently from the file), but a `when` EQUAL to it
// passed every gate on a fresh database while `pnpm db:migrate` reported
// success and applied nothing on a database at the previous head. Two branches
// that each step the same last entry by the same amount produce exactly that.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  JOURNAL_WHEN_STEP_MS,
  collectMigrationJournalFaults,
  listMigrationSqlTags,
  readMigrationJournal,
  validateMigrationJournal,
  type MigrationJournalEntry,
} from './migration-journal-order'

const HEAD: readonly MigrationJournalEntry[] = [
  { idx: 0, tag: '0000_baseline', when: 1_000 },
  { idx: 1, tag: '0001_db_constructs', when: 2_000 },
  { idx: 2, tag: '0002_first_change', when: 3_000 },
]
const tagsOf = (entries: readonly MigrationJournalEntry[]) =>
  entries.map(({ tag }) => tag)
const faults = (entries: readonly MigrationJournalEntry[], sqlTags = tagsOf(entries)) =>
  validateMigrationJournal(entries, sqlTags).map(({ detail }) => detail)

describe('migration journal order', () => {
  it('accepts a journal whose entries rise in position, idx and when', () => {
    expect(faults(HEAD)).toEqual([])
    expect(faults([...HEAD, { idx: 3, tag: '0003_next', when: 3_001 }])).toEqual([])
  })

  it('rejects a new entry stamped with the same when as its predecessor', () => {
    const journal = [...HEAD, { idx: 3, tag: '0003_parallel_branch', when: 3_000 }]

    expect(validateMigrationJournal(journal, tagsOf(journal))).toEqual([
      {
        object: 'migration 0003_parallel_branch',
        detail:
          'when 3000 is not above 3000 of 0002_first_change, so a database that already applied 0002_first_change skips it; ' +
          `set when above the previous entry (the journal steps by ${JOURNAL_WHEN_STEP_MS})`,
      },
    ])
  })

  it('rejects a new entry stamped with real time while the journal is dated ahead', () => {
    const journal = [...HEAD, { idx: 3, tag: '0003_real_time', when: 2_500 }]

    expect(faults(journal)).toEqual([
      'when 2500 is not above 3000 of 0002_first_change, so a database that already applied 0002_first_change skips it; ' +
        `set when above the previous entry (the journal steps by ${JOURNAL_WHEN_STEP_MS})`,
    ])
  })

  it('rejects an idx that is not the entry position', () => {
    const journal = [...HEAD, { idx: 2, tag: '0003_copied_idx', when: 4_000 }]

    expect(faults(journal)).toEqual(['idx 2 is not its position 3 in the journal'])
  })

  it('rejects a tag journalled twice', () => {
    const journal = [...HEAD, { idx: 3, tag: '0002_first_change', when: 4_000 }]

    expect(faults(journal)).toEqual(['tag is journalled more than once'])
  })

  it('rejects an entry with no SQL file and a SQL file with no entry', () => {
    const journal = [...HEAD, { idx: 3, tag: '0003_renamed', when: 4_000 }]

    expect(validateMigrationJournal(journal, [...tagsOf(HEAD), '0003_old_name'])).toEqual(
      [
        {
          object: 'migration 0003_renamed',
          detail: 'journal entry has no drizzle/0003_renamed.sql',
        },
        {
          object: 'migration 0003_old_name',
          detail: 'drizzle/0003_old_name.sql has no journal entry, so it never runs',
        },
      ],
    )
  })

  it('holds for the committed journal and every SQL file beside it', () => {
    const entries = readMigrationJournal()

    expect(entries.length).toBeGreaterThan(HEAD.length)
    expect(validateMigrationJournal(entries, listMigrationSqlTags())).toEqual([])
  })
})

describe('migration journal continuity with a database', () => {
  /** The rows a database holds after applying the committed journal in full. */
  const applied = readMigrationJournal().map(({ tag, when }) => ({
    createdAt: when,
    hash: createHash('sha256')
      .update(
        readFileSync(new URL(`../../../drizzle/${tag}.sql`, import.meta.url), 'utf8'),
      )
      .digest('hex'),
  }))
  const last = readMigrationJournal().at(-1)

  it('accepts the rows a full migration leaves', () => {
    expect(collectMigrationJournalFaults(applied)).toEqual([])
  })

  it('reports a database that applied fewer migrations than the journal holds', () => {
    expect(collectMigrationJournalFaults(applied.slice(0, -1))).toEqual([
      {
        object: 'drizzle.__drizzle_migrations',
        detail: `row count ${applied.length - 1} vs journal entries ${applied.length}`,
      },
    ])
  })

  it('reports an applied row whose SQL or timestamp is not the journal entry', () => {
    const edited = applied.map((row, index) =>
      index === applied.length - 1
        ? { createdAt: row.createdAt + 1, hash: 'edited' }
        : row,
    )

    expect(collectMigrationJournalFaults(edited)).toEqual([
      {
        object: `migration ${last?.tag}`,
        detail: `created_at ${(last?.when ?? 0) + 1} vs journal when ${last?.when}`,
      },
      {
        object: `migration ${last?.tag}`,
        detail: 'db hash differs from sha256 of the SQL file on disk',
      },
    ])
  })
})
