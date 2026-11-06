import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  evaluateMigrationJournal,
  readBaseJournal,
  type Git,
} from '../check-migration-journal'
import type { MigrationJournalEntry } from '../../src/shared/db/migration-journal-order'

const BASE: readonly MigrationJournalEntry[] = [
  { idx: 0, tag: '0000_baseline', when: 1_000 },
  { idx: 1, tag: '0001_constraints', when: 2_000 },
]
const APPENDED = { idx: 2, tag: '0002_new', when: 3_000 }
const ORIGINAL_SQL = 'CREATE TABLE example (id integer);\n'

describe('migration SQL immutability at the merge base', () => {
  let directory: string
  let baseTree: string

  const git = (args: readonly string[]) => {
    const result = spawnSync('git', [...args], { cwd: directory, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`fixture git ${args[0]} failed`)
    return result.stdout.trim()
  }
  const pathOf = (tag: string) => join(directory, 'drizzle', `${tag}.sql`)

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'migration-immutability-'))
    mkdirSync(join(directory, 'drizzle', 'meta'), { recursive: true })
    writeFileSync(
      join(directory, 'drizzle', 'meta', '_journal.json'),
      JSON.stringify({ entries: BASE }),
    )
    for (const { tag } of BASE) writeFileSync(pathOf(tag), ORIGINAL_SQL)
    git(['init', '--quiet'])
    git(['add', 'drizzle'])
    // A tree is enough for show/diff; no fixture commit or branch is needed.
    baseTree = git(['write-tree'])
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  const readBase = (diffFails = false) => {
    const run: Git = (args) => {
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'origin/main' }
      if (args[0] === 'merge-base') return { status: 0, stdout: baseTree }
      if (diffFails && args[0] === 'diff') return { status: 128, stdout: '' }
      const result = spawnSync('git', [...args], { cwd: directory, encoding: 'utf8' })
      return { status: result.status ?? 1, stdout: result.stdout ?? '' }
    }
    return readBaseJournal(run, {})
  }

  const evaluate = (entries = BASE, diffFails = false) =>
    evaluateMigrationJournal({
      entries,
      sqlTags: entries.map(({ tag }) => tag),
      base: readBase(diffFails),
      requireBase: true,
    })

  it('accepts unchanged historical SQL and a newly appended migration', () => {
    expect(evaluate().exitCode).toBe(0)
    writeFileSync(pathOf(APPENDED.tag), 'CREATE TABLE another (id integer);\n')
    git(['add', 'drizzle'])

    expect(evaluate([...BASE, APPENDED]).exitCode).toBe(0)
    writeFileSync(pathOf(APPENDED.tag), 'CREATE TABLE another (id bigint);\n')
    expect(evaluate([...BASE, APPENDED]).exitCode).toBe(0)
  })

  it.each(['unstaged', 'staged'])(
    'rejects %s changes to SQL already on the base',
    (state) => {
      const tag = BASE[1]!.tag
      writeFileSync(pathOf(tag), 'CREATE TABLE example (id bigint);\n')
      if (state === 'staged') git(['add', 'drizzle'])

      const result = evaluate()

      expect(result.exitCode).toBe(1)
      expect(result.lines.join('\n')).toContain(`migration ${tag}`)
      expect(result.lines.join('\n')).toContain('SQL differs')
    },
  )

  it('rejects removal even if the entry and SQL tag disappear together', () => {
    rmSync(pathOf(BASE[1]!.tag))

    const result = evaluate(BASE.slice(0, 1))

    expect(result.exitCode).toBe(1)
    expect(result.lines.join('\n')).toContain('SQL differs')
  })

  it('rejects an edited index even when the working file is restored to the base', () => {
    const tag = BASE[0]!.tag
    writeFileSync(pathOf(tag), 'CREATE TABLE example (id bigint);\n')
    git(['add', 'drizzle'])
    writeFileSync(pathOf(tag), ORIGINAL_SQL)

    expect(evaluate().exitCode).toBe(1)
  })

  it('rejects a rename even when Git could pair identical SQL as a rename', () => {
    renameSync(pathOf(BASE[1]!.tag), pathOf('0001_renamed'))
    git(['add', 'drizzle'])

    const result = evaluate()

    expect(result.exitCode).toBe(1)
    expect(result.lines.join('\n')).toContain(`migration ${BASE[1]!.tag}`)
    expect(result.lines.join('\n')).toContain('SQL differs')
  })

  it('rejects a newline-only edit because the applied SQL hash would change', () => {
    writeFileSync(pathOf(BASE[0]!.tag), ORIGINAL_SQL.trimEnd())

    expect(evaluate().exitCode).toBe(1)
  })

  it('reports every changed historical file while allowing unrelated files', () => {
    for (const { tag } of BASE) writeFileSync(pathOf(tag), `${ORIGINAL_SQL}-- edit\n`)
    writeFileSync(join(directory, 'drizzle', 'meta', 'snapshot.json'), '{}')
    git(['add', 'drizzle'])

    const result = evaluate()

    expect(result.exitCode).toBe(1)
    expect(result.lines.filter((line) => line.includes('SQL differs'))).toHaveLength(2)
  })

  it('fails closed when Git cannot compare the historical SQL', () => {
    const result = evaluate(BASE, true)

    expect(result.exitCode).toBe(1)
    expect(result.lines.join('\n')).toContain('cannot be compared')
  })
})
