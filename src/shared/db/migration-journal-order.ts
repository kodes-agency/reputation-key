// Migration journal: what is on disk, and whether a database could apply it.
//
// `drizzle/meta/_journal.json` is the order of record. drizzle-orm's migrator
// reads the newest applied row and then applies each entry, in array order,
// whose `when` is GREATER than that row's `created_at`. Position decides the
// order on an empty database; `when` decides whether an entry runs at all on a
// database that is already migrated. The file is appended by hand, so both are
// typed, and they must agree: every entry's `when` has to rise above the entry
// before it, or the entry is applied in CI (which migrates an empty database)
// and silently skipped on the deployed one.
//
// Shared/db only: consumed by ./schema-drift.ts, which backs
// `pnpm check:schema-drift` and migration-verification.test.ts.

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export type MigrationJournalEntry = Readonly<{ idx: number; tag: string; when: number }>

/** A fault in the journal: the object it concerns and what is wrong with it. */
export type MigrationJournalFault = Readonly<{ object: string; detail: string }>

/**
 * The step the hand-kept journal uses between entries. Its last `when` is
 * dated ahead of the calendar, so a real timestamp sorts BELOW it; step from
 * the previous entry instead.
 */
export const JOURNAL_WHEN_STEP_MS = 100_000_000

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../drizzle', import.meta.url))
const SQL_SUFFIX = '.sql'

export function readMigrationJournal(): readonly MigrationJournalEntry[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): repo-constant path (drizzle/), no request input; CI/operator tool
  const raw = readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')
  return (JSON.parse(raw) as { entries: MigrationJournalEntry[] }).entries
}

/** Tags of the migration SQL files on disk, sorted. */
export function listMigrationSqlTags(): readonly string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): repo-constant path (drizzle/), no request input; CI/operator tool
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(SQL_SUFFIX))
    .map((name) => name.slice(0, -SQL_SUFFIX.length))
    .sort()
}

function migrationSqlHash(tag: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): tag comes from the committed drizzle journal, not request input; CI/operator tool
  const sql = readFileSync(join(MIGRATIONS_DIR, `${tag}${SQL_SUFFIX}`), 'utf8')
  return createHash('sha256').update(sql).digest('hex')
}

function fault(tag: string, detail: string): MigrationJournalFault {
  return { object: `migration ${tag}`, detail }
}

function positionFaults(
  entry: MigrationJournalEntry,
  position: number,
): readonly MigrationJournalFault[] {
  return entry.idx === position
    ? []
    : [
        fault(
          entry.tag,
          `idx ${entry.idx} is not its position ${position} in the journal`,
        ),
      ]
}

function orderFaults(
  entry: MigrationJournalEntry,
  previous: MigrationJournalEntry | undefined,
): readonly MigrationJournalFault[] {
  if (!previous || entry.when > previous.when) return []
  return [
    fault(
      entry.tag,
      `when ${entry.when} is not above ${previous.when} of ${previous.tag}, so a database that already applied ${previous.tag} skips it; ` +
        `set when above the previous entry (the journal steps by ${JOURNAL_WHEN_STEP_MS})`,
    ),
  ]
}

function fileFaults(
  entries: readonly MigrationJournalEntry[],
  sqlTags: readonly string[],
): readonly MigrationJournalFault[] {
  const journalled = new Set(entries.map(({ tag }) => tag))
  const onDisk = new Set(sqlTags)
  return [
    ...entries
      .filter(({ tag }) => !onDisk.has(tag))
      .map(({ tag }) => fault(tag, `journal entry has no drizzle/${tag}.sql`)),
    ...sqlTags
      .filter((tag) => !journalled.has(tag))
      .map((tag) =>
        fault(tag, `drizzle/${tag}.sql has no journal entry, so it never runs`),
      ),
  ]
}

/**
 * Faults in the journal file itself, found with no database: an `idx` that is
 * not the entry's position, a `when` that does not rise above the entry before
 * it, a tag journalled twice, and a journal entry or SQL file with no
 * counterpart.
 */
export function validateMigrationJournal(
  entries: readonly MigrationJournalEntry[],
  sqlTags: readonly string[],
): readonly MigrationJournalFault[] {
  const perEntry = entries.flatMap((entry, position) => [
    ...positionFaults(entry, position),
    ...orderFaults(entry, entries[position - 1]),
    ...(entries.findIndex(({ tag }) => tag === entry.tag) === position
      ? []
      : [fault(entry.tag, 'tag is journalled more than once')]),
  ])
  return [...perEntry, ...fileFaults(entries, sqlTags)]
}

/** A row of `drizzle.__drizzle_migrations`, in the order the database sorts them. */
export type AppliedMigration = Readonly<{ hash: string; createdAt: number }>

function appliedFaults(
  entry: MigrationJournalEntry,
  row: AppliedMigration | undefined,
): readonly MigrationJournalFault[] {
  if (!row) return []
  return [
    ...(row.createdAt === entry.when
      ? []
      : [fault(entry.tag, `created_at ${row.createdAt} vs journal when ${entry.when}`)]),
    ...(row.hash === migrationSqlHash(entry.tag)
      ? []
      : [fault(entry.tag, 'db hash differs from sha256 of the SQL file on disk')]),
  ]
}

/** Applied rows against the journal, position by position. */
function continuityFaults(
  entries: readonly MigrationJournalEntry[],
  applied: readonly AppliedMigration[],
): readonly MigrationJournalFault[] {
  if (applied.length !== entries.length) {
    return [
      {
        object: 'drizzle.__drizzle_migrations',
        detail: `row count ${applied.length} vs journal entries ${entries.length}`,
      },
    ]
  }
  return entries.flatMap((entry, position) => appliedFaults(entry, applied[position]))
}

/**
 * The committed journal's own faults or, when it has none, its continuity with
 * the rows a database applied (ordered by `created_at`, then `id`). A journal
 * that is wrong on disk is reported alone: comparing a database with it only
 * repeats the fault once for every later entry.
 */
export function collectMigrationJournalFaults(
  applied: readonly AppliedMigration[],
): readonly MigrationJournalFault[] {
  const entries = readMigrationJournal()
  const onDisk = validateMigrationJournal(entries, listMigrationSqlTags())
  return onDisk.length > 0 ? onDisk : continuityFaults(entries, applied)
}
