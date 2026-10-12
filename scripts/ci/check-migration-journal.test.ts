// The gate lives in scripts/ (it reads shared/db, which scripts/ci may not
// import); its test lives here, with the other gate tests the unit project runs.

import { describe, expect, it } from 'vitest'
import type { MigrationJournalEntry } from '../../src/shared/db/migration-journal-order'
import {
  evaluateMigrationJournal,
  readBaseJournal,
  type BaseJournal,
  type Git,
} from '../check-migration-journal'

const MAIN: readonly MigrationJournalEntry[] = [
  { idx: 0, tag: '0000_baseline', when: 1_000 },
  { idx: 1, tag: '0001_db_constructs', when: 2_000 },
  { idx: 2, tag: '0002_from_main', when: 3_000 },
]
const MERGE_BASE = '8ded8e957d414866ebca628600d05977d8010e60'
const tagsOf = (entries: readonly MigrationJournalEntry[]) =>
  entries.map(({ tag }) => tag)

/** A git that knows the given refs and holds MAIN's journal at the merge base. */
function gitWith(
  refs: readonly string[],
  journal = JSON.stringify({ entries: MAIN }),
): Git & { calls: string[][] } {
  const calls: string[][] = []
  const git = (args: readonly string[]) => {
    calls.push([...args])
    const [command, ...rest] = args
    if (command === 'rev-parse') {
      return { status: refs.includes(rest.at(-1) ?? '') ? 0 : 1, stdout: '' }
    }
    if (command === 'merge-base') return { status: 0, stdout: MERGE_BASE }
    return { status: 0, stdout: journal }
  }
  return Object.assign(git, { calls })
}

const found = (entries: readonly MigrationJournalEntry[]): BaseJournal => ({
  kind: 'found',
  ref: 'origin/main',
  mergeBase: MERGE_BASE,
  entries,
})

describe('readBaseJournal', () => {
  it('reads the journal at the merge base of HEAD and origin/main', () => {
    const git = gitWith(['origin/main', 'main'])

    expect(readBaseJournal(git, {})).toEqual(found(MAIN))
    expect(git.calls).toEqual([
      ['rev-parse', '--verify', '--quiet', 'origin/main'],
      ['merge-base', 'origin/main', 'HEAD'],
      ['show', `${MERGE_BASE}:drizzle/meta/_journal.json`],
    ])
  })

  it('prefers MIGRATION_JOURNAL_BASE, and falls back to a local main', () => {
    expect(
      readBaseJournal(gitWith(['release', 'origin/main']), {
        MIGRATION_JOURNAL_BASE: ' release ',
      }),
    ).toMatchObject({ kind: 'found', ref: 'release' })
    expect(readBaseJournal(gitWith(['main']), {})).toMatchObject({
      kind: 'found',
      ref: 'main',
    })
  })

  it('says which refs it tried when none exists', () => {
    expect(readBaseJournal(gitWith([]), { MIGRATION_JOURNAL_BASE: 'release' })).toEqual({
      kind: 'no-base-ref',
      tried: ['release', 'origin/main', 'main'],
    })
  })

  it('reports a base journal that is not JSON instead of comparing nothing', () => {
    expect(readBaseJournal(gitWith(['origin/main'], '<<<<<<< HEAD'), {})).toMatchObject({
      kind: 'unreadable',
      ref: 'origin/main',
      reason: expect.stringContaining(
        `drizzle/meta/_journal.json at ${MERGE_BASE} is not JSON`,
      ),
    })
  })
})

describe('evaluateMigrationJournal', () => {
  const evaluate = (
    entries: readonly MigrationJournalEntry[],
    base: BaseJournal,
    requireBase = true,
  ) => evaluateMigrationJournal({ entries, sqlTags: tagsOf(entries), base, requireBase })

  it('passes a branch that appends after the entries main holds', () => {
    const appended = [...MAIN, { idx: 3, tag: '0003_new', when: 4_000 }]

    expect(evaluate(appended, found(MAIN))).toEqual({
      exitCode: 0,
      lines: [
        '[migration-journal] OK — 4 entries in order; the 3 on origin/main (merge-base 8ded8e957d41) are unchanged, 1 appended after them',
      ],
    })
  })

  it('fails the rebase that keeps the new entry before the one main gained', () => {
    // main's 0002 was moved after the branch's entry and its `when` raised, so
    // the file rises. A deployed database would run 0002_from_main again and
    // skip 0002_new; the file's own order check has nothing to say.
    const rebased = [
      ...MAIN.slice(0, 2),
      { idx: 2, tag: '0002_new', when: 3_000 },
      { idx: 3, tag: '0002_from_main', when: 4_000 },
    ]

    expect(evaluate(rebased, found(MAIN))).toEqual({
      exitCode: 1,
      lines: [
        '[migration-journal] FAILED — 1 fault(s):',
        '  ✗ migration 0002_from_main — is entry 2 on main, and 0002_new holds that position here; ' +
          'an entry already on main keeps its position, idx and when, because a deployed database has applied it as main states it — put the new entry after it, last',
      ],
    })
  })

  it('reports the file order fault and the base fault together', () => {
    const raised = [
      ...MAIN.slice(0, 2),
      { idx: 2, tag: '0002_from_main', when: 5_000 },
      { idx: 3, tag: '0003_new', when: 5_000 },
    ]
    const { exitCode, lines } = evaluate(raised, found(MAIN))

    expect(exitCode).toBe(1)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('migration 0003_new — when 5000 is not above 5000')
    expect(lines[2]).toContain(
      'migration 0002_from_main — when is 5000 here and 3000 on main',
    )
  })

  it('fails in CI when no base ref exists, and skips only that check locally', () => {
    const noBase: BaseJournal = { kind: 'no-base-ref', tried: ['origin/main', 'main'] }

    expect(evaluate(MAIN, noBase)).toEqual({
      exitCode: 1,
      lines: [
        '[migration-journal] FAILED — 1 fault(s):',
        '  ✗ no base ref found (tried origin/main, main), so the journal on main cannot be compared — fetch main (CI: actions/checkout fetch-depth: 0)',
      ],
    })
    expect(evaluate(MAIN, noBase, false).exitCode).toBe(0)
    expect(evaluate(MAIN, noBase, false).lines.at(-1)).toBe(
      '[migration-journal] OK — 3 entries in order; append-only check SKIPPED (local run without a main ref)',
    )
  })

  it('still fails a local run without a base ref on the file order', () => {
    const noBase: BaseJournal = { kind: 'no-base-ref', tried: ['origin/main', 'main'] }
    const unordered = [...MAIN, { idx: 3, tag: '0003_new', when: 3_000 }]

    expect(evaluate(unordered, noBase, false).exitCode).toBe(1)
    expect(evaluate(unordered, noBase, false).lines).toHaveLength(2)
  })

  it('fails when the base journal cannot be read, in CI and locally', () => {
    const unreadable: BaseJournal = {
      kind: 'unreadable',
      ref: 'origin/main',
      reason: 'git merge-base origin/main HEAD failed',
    }

    expect(evaluate(MAIN, unreadable, false)).toEqual({
      exitCode: 1,
      lines: [
        '[migration-journal] FAILED — 1 fault(s):',
        '  ✗ base origin/main — git merge-base origin/main HEAD failed; the journal on main cannot be compared',
      ],
    })
  })
})
