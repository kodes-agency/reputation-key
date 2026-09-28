import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  collectUncheckedIndexDiagnostics,
  countsOf,
  loadRepositoryProgram,
} from './check-unchecked-indexed-access'
import { compareWithBaseline, parseBaseline, serializeBaseline } from './ratchet-baseline'

const ROOT = resolve(import.meta.dirname, '../..')

// Small and self-contained: no repository types, only the ES2022 lib.
const FIXTURE_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts'],
  types: [],
  skipLibCheck: true,
}

const UNGUARDED = 'export const firstX = (rows: { x: number }[]): number => rows[0].x\n'
const GUARDED =
  'export const firstX = (rows: { x: number }[]): number | undefined => rows[0]?.x\n'

describe('noUncheckedIndexedAccess ratchet', () => {
  let root: string
  let rootNames: readonly string[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'repkey-unchecked-index-'))
    writeFileSync(join(root, 'unguarded.ts'), UNGUARDED)
    writeFileSync(join(root, 'guarded.ts'), GUARDED)
    rootNames = [join(root, 'unguarded.ts'), join(root, 'guarded.ts')]
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('fails an unguarded arr[0].x that no baseline entry covers', () => {
    const diagnostics = collectUncheckedIndexDiagnostics({
      root,
      rootNames,
      options: FIXTURE_OPTIONS,
    })

    const column = UNGUARDED.indexOf('rows[0]') + 1
    expect([...diagnostics]).toEqual([
      ['unguarded.ts', [`1:${column} TS2532 Object is possibly 'undefined'.`]],
    ])
    expect(compareWithBaseline({}, countsOf(diagnostics)).regressions).toEqual([
      { file: 'unguarded.ts', baseline: 0, current: 1 },
    ])
  })

  it('passes the same read once the baseline records it', () => {
    const current = countsOf(
      collectUncheckedIndexDiagnostics({ root, rootNames, options: FIXTURE_OPTIONS }),
    )

    expect(compareWithBaseline({ 'unguarded.ts': 1 }, current)).toEqual({
      regressions: [],
      improvements: [],
    })
  })

  it('counts only what the flag adds: the fixture is clean without it', () => {
    const program = ts.createProgram({ rootNames, options: FIXTURE_OPTIONS })

    expect(ts.getPreEmitDiagnostics(program)).toEqual([])
  })

  it('checks every project pnpm typecheck runs, on the base options', () => {
    const input = loadRepositoryProgram(ROOT)

    expect(input.rootNames).toContain(resolve(ROOT, 'src/start.ts'))
    expect(input.rootNames).toContain(resolve(ROOT, 'scripts/seed.ts'))
    expect(input.options.strict).toBe(true)
    // The gate adds the flag itself. Once tsconfig.json sets it, delete the gate.
    expect(input.options.noUncheckedIndexedAccess).toBeUndefined()
  })

  it('keeps the committed baseline in its generated form', () => {
    // A hand edit or a merge of two baselines must still be exactly what
    // --write-baseline would produce, or the next rewrite diffs noisily.
    const bytes = readFileSync(
      resolve(ROOT, 'scripts/ci/unchecked-indexed-access.baseline.json'),
      'utf8',
    )

    expect(serializeBaseline(parseBaseline(bytes))).toBe(bytes)
  })
})
