// What the documents say about the beta database and its backups, held to the
// migration journal and to each other.
//
// Until 2026-10-13 the beta contract called the application stopped and the
// database disposable, and kept its recovery targets and the backup item of
// the release checklist dormant on that premise. By then the journal had been
// appended to for five weeks, the deploy tool named a live environment, and
// the database guide said the beta database keeps its data. The backup record
// gave an inspection made before that database existed as its present state.
//
// Whether a backup exists is a fact about the live environment that no test
// can read. What is held here: no current page calls the database disposable
// while the journal says it is migrated forward, and the contract marks its
// backup statements unverified for exactly as long as the backup record does.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME } from '#/shared/release/railway-deployment-profile'

const read = (path: string): string => readFileSync(path, 'utf8')

const CONTRACT = read('docs/BETA.md')
const BACKUP_RECORD = read('docs/operations/backup-and-lifecycle.md')
const DATABASE_GUIDE = read('src/shared/db/CONTEXT.md')
const JOURNAL = JSON.parse(read('drizzle/meta/_journal.json')) as {
  entries: readonly unknown[]
}

/** The baseline, the DB-only constructs and the seed: what `pnpm db:baseline` writes. */
const GENERATED_JOURNAL_ENTRIES = 3
const CHANGE_LOG_HEADING = '## 10. Change log'
const BACKUP_RECORD_SECTION = '§1'
const RECORDED_STATE_LEAD = '**Recorded backup state of the beta database'
/** How a statement nobody has checked against the live environment is marked. */
const UNVERIFIED = /\*\*UNVERIFIED — owner to confirm \(\d{4}-\d{2}-\d{2}\)[:.]?\*\*/u

/** Sentences that were true of an application that is not running. */
const STOPPED_OR_DISPOSABLE = [
  /application is stopped/iu,
  /database is disposable/iu,
  /production database exists again/iu,
  /before the deployment becomes accepting/iu,
] as const

/** The page without its change log, which is history and may quote what it corrects. */
function currentContract(): string {
  const end = CONTRACT.indexOf(CHANGE_LOG_HEADING)
  expect(end).toBeGreaterThan(-1)
  return CONTRACT.slice(0, end)
}

/** The one line of the contract that starts with `start`. */
function contractLine(start: string): string {
  return (
    currentContract()
      .split('\n')
      .find((line) => line.startsWith(start)) ?? ''
  )
}

/** The paragraph of the backup record that opens with the recorded-state lead. */
function recordedBackupState(): string {
  const start = BACKUP_RECORD.indexOf(RECORDED_STATE_LEAD)
  return start === -1 ? '' : (BACKUP_RECORD.slice(start).split(/\n\s*\n/u)[0] ?? '')
}

const CURRENT_PAGES: readonly (readonly [string, string])[] = [
  ['docs/BETA.md', currentContract()],
  ['docs/operations/backup-and-lifecycle.md', BACKUP_RECORD],
  ['docs/operations/runbooks.md', read('docs/operations/runbooks.md')],
  ['src/shared/db/CONTEXT.md', DATABASE_GUIDE],
  [
    'src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts',
    read('src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts'),
  ],
]

describe('what the documents say about the beta database', () => {
  it('is said of a database that is migrated forward, not regenerated', () => {
    expect(JOURNAL.entries.length).toBeGreaterThan(GENERATED_JOURNAL_ENTRIES)
    expect(DATABASE_GUIDE).toContain('keeps its data between deploys')
  })

  // R5E-11: the contract said both, and a comment gave "disposable" as the
  // reason a ciphertext format needs no reader.
  it.each(CURRENT_PAGES)(
    '%s does not call the application stopped or the database disposable',
    (_path, text) => {
      const stale = STOPPED_OR_DISPOSABLE.filter((sentence) => sentence.test(text)).map(
        (sentence) => sentence.source,
      )

      expect(stale).toEqual([])
    },
  )

  it('says in the contract where the beta runs and since when its database has kept its data', () => {
    const commitments = contractLine('Internal engineering objectives')
    const started = /started empty on (\d{4}-\d{2}-\d{2})/u.exec(DATABASE_GUIDE)?.[1]

    expect(started).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    expect(commitments).toContain(`\`${CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME}\``)
    expect(commitments).toContain(`started empty on ${started}`)
    expect(commitments).not.toContain('dormant')
  })
})

describe('what the documents say about its backups', () => {
  const checklistItem = contractLine('- Backup verified within the last 30 days')
  const commitments = contractLine('Internal engineering objectives')

  it('keeps one place in the backup record for the state of the beta database', () => {
    expect(recordedBackupState()).toContain(CLOSED_BETA_RAILWAY_ENVIRONMENT_NAME)
    expect(checklistItem).toContain(
      `\`docs/operations/backup-and-lifecycle.md\` ${BACKUP_RECORD_SECTION}`,
    )
    expect(commitments).toContain(
      `\`docs/operations/backup-and-lifecycle.md\` ${BACKUP_RECORD_SECTION}`,
    )
  })

  // The contract may not call a backup verified while the record it cites says
  // nobody has looked, nor stay marked once the record holds the answer.
  it('marks the contract unverified for exactly as long as the backup record is', () => {
    const recordUnverified = UNVERIFIED.test(recordedBackupState())

    expect({
      checklistItem: UNVERIFIED.test(checklistItem),
      commitments: UNVERIFIED.test(commitments),
    }).toEqual({ checklistItem: recordUnverified, commitments: recordUnverified })
  })
})
