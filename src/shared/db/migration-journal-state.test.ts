import { describe, expect, it } from 'vitest'
import {
  deployFailureRecovery,
  deployMigrationStateRefusal,
  migrationJournalPosition,
} from './migration-journal-state'

const reached = {
  applied: 55,
  journalEntries: 55,
  hasAuthTables: true,
  hasProviderSubjectKey: true,
} as const

const INCOMPLETE =
  'Migration state incomplete after the schema tracks — see the state line above. ' +
  'Fix forward and redeploy; the rerun converges.'

describe('migrationJournalPosition', () => {
  it('is matched when every journal entry is applied and nothing more', () => {
    expect(migrationJournalPosition(55, 55)).toBe('matched')
  })

  it('is behind while the image carries migrations the database has not applied', () => {
    expect(migrationJournalPosition(54, 55)).toBe('database_behind')
    expect(migrationJournalPosition(0, 55)).toBe('database_behind')
  })

  it('is ahead when the database applied migrations the image does not carry', () => {
    expect(migrationJournalPosition(56, 55)).toBe('database_ahead')
  })

  it('reads an unreadable count as behind, never as ahead', () => {
    expect(migrationJournalPosition(null, 55)).toBe('database_behind')
    expect(migrationJournalPosition(Number.NaN, 55)).toBe('database_behind')
  })
})

describe('deployMigrationStateRefusal', () => {
  it('lets the deploy through once the journal, auth tables and subject key are in place', () => {
    expect(deployMigrationStateRefusal(reached)).toBeNull()
  })

  it('refuses an image older than the database by design and never promises convergence', () => {
    const refusal = deployMigrationStateRefusal({ ...reached, applied: 56 })

    expect(refusal?.name).toBe('ImageOlderThanDatabaseError')
    expect(refusal?.message).toBe(
      "This image is older than the database: 56 migrations are applied and this image's journal holds 55. " +
        'An image older than the applied migrations is refused by design: recovery is forward-only (ADR 0038), ' +
        'and rerunning or redeploying this image never converges. Deploy a fix forward (runbooks.md §28). ' +
        'An image built from current main that is refused this way has a journal that lost a migration ' +
        'the database applied (a revert deleted it): the fix restores that migration file and its journal entry.',
    )
    expect(refusal?.message).not.toContain('the rerun converges')
  })

  // A plain revert of a migration commit deletes the migration, CI stays green
  // on an empty database, and the "fix" is then the image this gate refuses.
  it('tells the operator whose fix is refused that its journal lost an applied migration', () => {
    const refusal = deployMigrationStateRefusal({
      ...reached,
      applied: 55,
      journalEntries: 54,
    })

    expect(refusal?.message).toContain(
      "55 migrations are applied and this image's journal holds 54.",
    )
    expect(refusal?.message).toContain(
      'An image built from current main that is refused this way has a journal that lost a migration',
    )
    expect(refusal?.message).toContain(
      'restores that migration file and its journal entry',
    )
  })

  it('names the older image even when another part of the state is also missing', () => {
    const refusal = deployMigrationStateRefusal({
      ...reached,
      applied: 56,
      hasProviderSubjectKey: false,
    })

    expect(refusal?.name).toBe('ImageOlderThanDatabaseError')
    expect(refusal?.message).toContain(
      'This image is older than the database: 56 migrations are applied',
    )
  })

  it.each([
    ['the database is behind the journal', { ...reached, applied: 54 }],
    ['the journal table is unreadable', { ...reached, applied: null }],
    ['the auth tables are missing', { ...reached, hasAuthTables: false }],
    ['the provider subject key is missing', { ...reached, hasProviderSubjectKey: false }],
  ])('keeps the incomplete message when %s', (_case, state) => {
    const refusal = deployMigrationStateRefusal(state)

    expect(refusal?.message).toBe(INCOMPLETE)
    expect(refusal?.name).toBe('Error')
  })
})

describe('deployFailureRecovery', () => {
  const RERUN =
    'Forward recovery: fix the failing migration SQL and redeploy — every step is idempotent, ' +
    'the rerun converges. Do NOT hand-roll partial schema state (runbooks.md §8).'

  it('tells the operator of an older image to deploy a newer release, not to rerun', () => {
    const recovery = deployFailureRecovery(
      deployMigrationStateRefusal({ ...reached, applied: 56 }),
    )

    expect(recovery).toBe(
      'Forward-only recovery: do not rerun this image, and do not edit ' +
        'drizzle.__drizzle_migrations to make it pass. Deploy a release whose journal carries ' +
        'every applied migration — a fix committed on current main, never a revert that deletes ' +
        'a migration file or its journal entry (runbooks.md §28).',
    )
    expect(recovery).not.toContain('the rerun converges')
  })

  it.each([
    ['an incomplete state', deployMigrationStateRefusal({ ...reached, applied: 54 })],
    ['a failing migration', new Error('relation "reviews" already exists')],
    ['a thrown non-error', 'connection refused'],
  ])('keeps the fix-and-rerun line for %s', (_case, failure) => {
    expect(deployFailureRecovery(failure)).toBe(RERUN)
  })

  it('tells the operator of a lock wait to redeploy, with nothing to fix in the SQL', () => {
    const lockTimeout = Object.assign(
      new Error('canceling statement due to lock timeout'),
      { code: '55P03' },
    )

    const recovery = deployFailureRecovery(
      new Error('Failed query: ALTER TABLE "portal_links"', { cause: lockTimeout }),
    )

    expect(recovery).toBe(
      'Lock wait: a migration statement waited 5 s for a lock another session holds and ' +
        'gave up, so that the application does not queue behind it. The journal runs in one ' +
        'transaction, so nothing of it was applied. Redeploy; if it happens again, find the ' +
        'session holding the lock (pg_stat_activity, pg_blocking_pids) first (runbooks.md §8).',
    )
    expect(recovery).not.toContain('fix the failing migration SQL')
  })
})
