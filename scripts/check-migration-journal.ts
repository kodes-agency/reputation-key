// Migration journal gate, with no database. Wired as
// `pnpm check:migration-journal` and run by `lint:ci`, in the `static` job,
// which checks out full history.
//
// WHAT. Two checks on drizzle/meta/_journal.json:
//   1. the file's own order (validateMigrationJournal): idx, a rising `when`,
//      one entry per tag, an SQL file for every entry. The same check is a unit
//      test and the first thing `pnpm check:schema-drift` does.
//   2. append-only against main (validateJournalIsAppendOnly): every entry of
//      the journal at the merge base with main is still here, unchanged, at the
//      same position.
//
// WHY 2. One file cannot tell a new entry from one a deployed database has
// applied. drizzle applies an entry only when its `when` is above the newest
// applied row, so an entry placed before applied ones is skipped there, and an
// applied entry whose `when` is raised runs again. A rebase that keeps the
// branch's entry first and raises the `when` of the one main gained does both:
// CI's empty database migrates cleanly, and the deployed database ends with as
// many rows as the journal has entries, so the deploy runner's count check
// passes as well.
//
// BASE. The first of MIGRATION_JOURNAL_BASE, origin/main and main that exists.
// The journal is read at the merge base of that ref and HEAD, so a branch that
// is only behind main is not blamed for entries it has not got yet. On main
// itself the merge base is HEAD and check 2 holds by construction: it bites on
// the pull request, where HEAD is the merge with main. With no base ref the
// gate fails in CI and runs check 1 alone locally.

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  listMigrationSqlTags,
  parseMigrationJournal,
  readMigrationJournal,
  validateJournalIsAppendOnly,
  validateMigrationJournal,
  type MigrationJournalEntry,
  type MigrationJournalFault,
} from '../src/shared/db/migration-journal-order'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const JOURNAL_PATH = 'drizzle/meta/_journal.json'
const BASE_OVERRIDE = 'MIGRATION_JOURNAL_BASE'
const DEFAULT_BASES = ['origin/main', 'main'] as const
const SHORT_SHA = 12

export type GitResult = Readonly<{ status: number; stdout: string }>
export type Git = (args: readonly string[]) => GitResult

/** The journal main holds, or why it cannot be read. */
export type BaseJournal =
  | Readonly<{
      kind: 'found'
      ref: string
      mergeBase: string
      entries: readonly MigrationJournalEntry[]
    }>
  | Readonly<{ kind: 'no-base-ref'; tried: readonly string[] }>
  | Readonly<{ kind: 'unreadable'; ref: string; reason: string }>

function runGit(args: readonly string[]): GitResult {
  const result = spawnSync('git', [...args], { cwd: ROOT, encoding: 'utf8' })
  return { status: result.status ?? 1, stdout: (result.stdout ?? '').trim() }
}

function journalAt(git: Git, ref: string, mergeBase: string): BaseJournal {
  const shown = git(['show', `${mergeBase}:${JOURNAL_PATH}`])
  if (shown.status !== 0) {
    return {
      kind: 'unreadable',
      ref,
      reason: `git show ${mergeBase}:${JOURNAL_PATH} failed`,
    }
  }
  try {
    return { kind: 'found', ref, mergeBase, entries: parseMigrationJournal(shown.stdout) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      kind: 'unreadable',
      ref,
      reason: `${JOURNAL_PATH} at ${mergeBase} cannot be parsed: ${reason}`,
    }
  }
}

/** The journal at the merge base of HEAD and the first base ref that exists. */
export function readBaseJournal(
  git: Git,
  env: Readonly<Record<string, string | undefined>>,
): BaseJournal {
  const override = (env[BASE_OVERRIDE] ?? '').trim()
  const tried = [...(override ? [override] : []), ...DEFAULT_BASES]
  const ref = tried.find(
    (candidate) => git(['rev-parse', '--verify', '--quiet', candidate]).status === 0,
  )
  if (!ref) return { kind: 'no-base-ref', tried }
  const mergeBase = git(['merge-base', ref, 'HEAD'])
  if (mergeBase.status !== 0 || mergeBase.stdout === '') {
    return { kind: 'unreadable', ref, reason: `git merge-base ${ref} HEAD failed` }
  }
  return journalAt(git, ref, mergeBase.stdout)
}

export type JournalGateInput = Readonly<{
  entries: readonly MigrationJournalEntry[]
  sqlTags: readonly string[]
  base: BaseJournal
  /** True in CI, where a missing base ref is a failure, not a skip. */
  requireBase: boolean
}>

export type JournalGateResult = Readonly<{
  exitCode: number
  /** Lines for stdout when the gate passes, for stderr when it fails. */
  lines: readonly string[]
}>

function describeFaults(faults: readonly MigrationJournalFault[]): readonly string[] {
  return faults.map(({ object, detail }) => `  ✗ ${object} — ${detail}`)
}

function failed(lines: readonly string[]): JournalGateResult {
  return {
    exitCode: 1,
    lines: [`[migration-journal] FAILED — ${lines.length} fault(s):`, ...lines],
  }
}

function withoutBase(
  base: Exclude<BaseJournal, { kind: 'found' }>,
  input: JournalGateInput,
  fileFaults: readonly MigrationJournalFault[],
): JournalGateResult {
  if (base.kind === 'unreadable') {
    return failed([
      ...describeFaults(fileFaults),
      `  ✗ base ${base.ref} — ${base.reason}; the journal on main cannot be compared`,
    ])
  }
  const missing =
    `no base ref found (tried ${base.tried.join(', ')}), so the journal on main cannot be compared — ` +
    'fetch main (CI: actions/checkout fetch-depth: 0)'
  if (input.requireBase || fileFaults.length > 0) {
    return failed([
      ...describeFaults(fileFaults),
      ...(input.requireBase ? [`  ✗ ${missing}`] : []),
    ])
  }
  return {
    exitCode: 0,
    lines: [
      `[migration-journal] ${missing}`,
      `[migration-journal] OK — ${input.entries.length} entries in order; append-only check SKIPPED (local run without a main ref)`,
    ],
  }
}

/** The gate's verdict, from the journal on disk and the one main holds. */
export function evaluateMigrationJournal(input: JournalGateInput): JournalGateResult {
  const fileFaults = validateMigrationJournal(input.entries, input.sqlTags)
  const { base } = input
  if (base.kind !== 'found') return withoutBase(base, input, fileFaults)
  const faults = [
    ...fileFaults,
    ...validateJournalIsAppendOnly(input.entries, base.entries),
  ]
  if (faults.length > 0) return failed(describeFaults(faults))
  const added = input.entries.length - base.entries.length
  return {
    exitCode: 0,
    lines: [
      `[migration-journal] OK — ${input.entries.length} entries in order; the ${base.entries.length} on ${base.ref} ` +
        `(merge-base ${base.mergeBase.slice(0, SHORT_SHA)}) are unchanged, ${added} appended after them`,
    ],
  }
}

function main(): number {
  const result = evaluateMigrationJournal({
    entries: readMigrationJournal(),
    sqlTags: listMigrationSqlTags(),
    base: readBaseJournal(runGit, process.env),
    requireBase: process.env.CI === 'true',
  })
  const stream = result.exitCode === 0 ? process.stdout : process.stderr
  stream.write(`${result.lines.join('\n')}\n`)
  return result.exitCode
}

// Real paths, not addresses compared as text: started through a symbolic link
// the text differed, and the gate printed nothing and exited 0. This is the
// check of scripts/ci/entry-point.ts, written out because the boundary policy
// keeps a script outside scripts/ci from importing that module.
const startedScript = process.argv[1]
if (
  startedScript !== undefined &&
  realpathSync(startedScript) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = main()
}
