// The migration authority requires an exact journal match. Runtime readiness
// also accepts later expands; a later contract ends compatibility.

import {
  isMigrationLockTimeout,
  MIGRATION_LOCK_TIMEOUT_MS,
} from './migration-lock-timeout'
import { ConcurrentIndexMigrationError } from './concurrent-index-migration'

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
 * repair is a newer release, never this image again. The count cannot tell an
 * old image from a new one whose journal was shortened, and nothing in CI
 * catches the second, so the message names it for the operator whose fix is
 * the image being refused.
 */
export class ImageOlderThanDatabaseError extends Error {
  constructor(applied: number, journalEntries: number) {
    super(
      `This image is older than the database: ${applied} migrations are applied and this image's journal holds ${journalEntries}. ` +
        'An image older than the applied migrations is refused by design: recovery is forward-only (ADR 0038), ' +
        'and rerunning or redeploying this image never converges. Deploy a fix forward (runbooks.md §28). ' +
        'An image built from current main that is refused this way has a journal that lost a migration ' +
        'the database applied (a revert deleted it): the fix restores that migration file and its journal entry.',
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
 * The error the deploy runner throws after the journal ran, or `null`
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
    'Migration state incomplete after the journal — see the state line above. ' +
      'Fix forward and redeploy; the rerun converges.',
  )
}

const LOCK_WAIT_SECONDS = MIGRATION_LOCK_TIMEOUT_MS / 1_000

const LOCK_WAIT_RECOVERY =
  `Lock wait: a migration statement waited ${LOCK_WAIT_SECONDS} s for a lock ` +
  'another session holds and gave up, so that the application does not queue behind it. ' +
  'The failed journal file was rolled back; earlier files remain applied. Redeploy; if it ' +
  'happens again, find the session holding the lock (pg_stat_activity, pg_blocking_pids) ' +
  'first (runbooks.md §8).'

/**
 * The recovery line the runner prints after a failure. An image older than the
 * database is repaired only by a newer release. A lock wait has nothing to
 * repair: the migration gave up waiting for another session, and a rerun converges
 * from whatever it left. Every other failure is repaired by fixing what failed
 * and rerunning.
 */
export function deployFailureRecovery(failure: unknown): string {
  if (failure instanceof ConcurrentIndexMigrationError) {
    return 'The concurrent-index file did not finish. Earlier files remain applied. Redeploy to inspect and repair an invalid index, or reuse a completed build, before recording its journal row.'
  }
  if (failure instanceof ImageOlderThanDatabaseError) {
    return (
      'Forward-only recovery: do not rerun this image, and do not edit ' +
      'drizzle.__drizzle_migrations to make it pass. Deploy a release whose journal carries ' +
      'every applied migration — a fix committed on current main, never a revert that deletes ' +
      'a migration file or its journal entry (runbooks.md §28).'
    )
  }
  if (isMigrationLockTimeout(failure)) return LOCK_WAIT_RECOVERY
  return (
    'Forward recovery: fix the failing migration SQL ' +
    'and redeploy — every step is idempotent, the rerun converges. ' +
    'Do NOT hand-roll partial schema state (runbooks.md §8).'
  )
}
