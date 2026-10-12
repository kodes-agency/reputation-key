// Migration journal state (BQC-7.1 / BQC-7.2) — how the migrations a database
// has applied compare with the journal the running image carries, and what the
// deploy runner says when the deploy migration state is not reached. Pure: no
// pool, no filesystem.
//
// Two gates require the applied count to equal the image's journal — the
// predeploy runner (scripts/migrate-deploy.ts) and the readiness probe
// (src/shared/health/readiness.ts). Both read the direction of a mismatch from
// here, so they cannot disagree about what it means:
//
//   database_behind — the image carries migrations the database has not
//                     applied: a deploy in flight or a failed migration. A
//                     rerun converges (runbooks.md §8).
//   database_ahead  — the database applied migrations the image does not
//                     carry: the image is older than the database. Refused by
//                     design, and no rerun converges (runbooks.md §28).

type MigrationJournalPosition = 'matched' | 'database_behind' | 'database_ahead'

/**
 * Where the database stands against the image's journal. An unreadable count
 * (`null`) is no evidence that the database is ahead, so it reads as behind.
 */
export function migrationJournalPosition(
  applied: number | null,
  journalEntries: number,
): MigrationJournalPosition {
  if (applied === journalEntries) return 'matched'
  return applied !== null && applied > journalEntries
    ? 'database_ahead'
    : 'database_behind'
}

/**
 * The database has applied migrations this image does not carry. Refused by
 * design: recovery is forward-only (ADR 0038, amended 2026-10-12), so the
 * repair is a newer release, never this image again.
 */
class ImageOlderThanDatabaseError extends Error {
  constructor(applied: number, journalEntries: number) {
    super(
      `This image is older than the database: ${applied} migrations are applied and this image's journal holds ${journalEntries}. ` +
        'An image older than the applied migrations is refused by design: recovery is forward-only (ADR 0038), ' +
        'and rerunning or redeploying this image never converges. Deploy a fix forward (runbooks.md §28).',
    )
    this.name = 'ImageOlderThanDatabaseError'
  }
}

type DeployMigrationState = Readonly<{
  /** Rows in drizzle.__drizzle_migrations; `null` when the table is unreadable. */
  applied: number | null
  /** Entries in the image's drizzle/meta/_journal.json. */
  journalEntries: number
  hasAuthTables: boolean
  hasProviderSubjectKey: boolean
}>

/**
 * The error the deploy runner throws after both schema tracks ran, or `null`
 * once the deploy migration state is reached. An older image is named first:
 * whatever else is missing, no rerun of it converges.
 */
export function deployMigrationStateRefusal(state: DeployMigrationState): Error | null {
  const { applied, journalEntries } = state
  const position = migrationJournalPosition(applied, journalEntries)
  if (applied !== null && position === 'database_ahead') {
    return new ImageOlderThanDatabaseError(applied, journalEntries)
  }
  const reached =
    position === 'matched' && state.hasAuthTables && state.hasProviderSubjectKey
  if (reached) return null
  return new Error(
    'Migration state incomplete after the schema tracks — see the state line above. ' +
      'Fix forward and redeploy; the rerun converges.',
  )
}

/**
 * The recovery line the runner prints after a failure. Every failure but one
 * is repaired by fixing what failed and rerunning; an image older than the
 * database is repaired only by a newer release.
 */
export function deployFailureRecovery(failure: unknown): string {
  return failure instanceof ImageOlderThanDatabaseError
    ? 'Forward-only recovery: do not rerun this image, and do not edit ' +
        'drizzle.__drizzle_migrations to make it pass. Deploy a release that carries ' +
        'every applied migration — the fix, built from current main (runbooks.md §28).'
    : 'Forward recovery: fix the failing migration SQL ' +
        'and redeploy — every step is idempotent, the rerun converges. ' +
        'Do NOT hand-roll partial schema state (runbooks.md §8).'
}
