// noUncheckedIndexedAccess ratchet (types-07).
//
// WHAT. Type-checks the repository once more with `noUncheckedIndexedAccess`
// on and counts the resulting diagnostics per file against
// unchecked-indexed-access.baseline.json. A file fails the gate when its count
// rises above its entry (a file without an entry may have none); counts that
// fall pass, and the gate asks for the entry to be lowered.
//
// WHY. tsconfig.json is `strict` but types `rows[0]`, `list[i]` and
// `record[key]` as `T`, not `T | undefined`, so reading the first row of an
// empty query result compiles and fails at runtime. Turning the flag on
// surfaced 552 errors in 155 files, too many for one change. The ratchet stops
// new ones while the baseline burns down. When it is empty, set the flag in
// tsconfig.json and delete this gate.
//
// SCOPE. One program: the root files of every project `pnpm typecheck` runs,
// with tsconfig.json's options (which tsconfig.scripts.json extends) plus the
// flag. That is what the flag will cover once set in tsconfig.json. Every
// diagnostic is attributed to the flag, which holds only while the program is
// clean without it, so CI runs `pnpm typecheck` before `lint:ci`. Run
// typecheck first locally too.
//
// COST. One program build, the time and heap of `tsc --noEmit`: about 40 s.
// It peaks between 3.5 and 4 GB of V8 heap, right at Node's default cap on a
// 16 GB runner, so a few hundred lines of new source tipped it over
// ("JavaScript heap out of memory", exit 134) with nothing wrong in them. The
// package script therefore sets `--max-old-space-size=6144` itself; run it
// through `pnpm check:unchecked-indexed-access`, not `tsx` directly.
//
// UPDATING THE BASELINE. `pnpm check:unchecked-indexed-access --write-baseline`
// (about a minute), then commit the JSON: when counts fell (the gate passes and
// asks for this), or a file with an entry moved. To fix a rise, guard the read
// (`?.`, `??`, an explicit check) rather than raising the entry.

import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { INVOKED_TYPESCRIPT_PROJECTS } from './check-typescript-project-coverage'
import {
  runRatchetGate,
  type RatchetChange,
  type RatchetCounts,
} from './ratchet-baseline'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BASELINE_PATH = resolve(ROOT, 'scripts/ci/unchecked-indexed-access.baseline.json')
const WRITE_COMMAND = 'pnpm check:unchecked-indexed-access --write-baseline'
/** Supplies the compiler options; every other invoked project extends it. */
const BASE_PROJECT = 'tsconfig.json'
const SHOWN_PER_FILE = 20

export type ProgramInput = Readonly<{
  root: string
  rootNames: readonly string[]
  options: ts.CompilerOptions
}>

/** Repository path → `line:column TScode message` for each diagnostic. */
export type IndexDiagnostics = ReadonlyMap<string, readonly string[]>

function flatten(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
    .join('; ')
}

function parseProject(root: string, project: string): ts.ParsedCommandLine {
  const configPath = resolve(root, project)
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile)
  if (loaded.error) throw new Error(`${project}: ${flatten([loaded.error])}`)
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath,
  )
  if (parsed.errors.length > 0) throw new Error(`${project}: ${flatten(parsed.errors)}`)
  return parsed
}

export function loadRepositoryProgram(root: string): ProgramInput {
  const projects = new Map(
    INVOKED_TYPESCRIPT_PROJECTS.map((project) => [project, parseProject(root, project)]),
  )
  const base = projects.get(BASE_PROJECT)
  if (!base) throw new Error(`${BASE_PROJECT} is not an invoked TypeScript project`)
  return {
    root,
    rootNames: [...new Set([...projects.values()].flatMap((parsed) => parsed.fileNames))],
    options: base.options,
  }
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const at =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : { line: 0, character: 0 }
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
  return `${at.line + 1}:${at.character + 1} TS${diagnostic.code} ${message}`
}

/** One program build with the flag on; diagnostics per repository source file. */
export function collectUncheckedIndexDiagnostics(input: ProgramInput): IndexDiagnostics {
  const program = ts.createProgram({
    rootNames: input.rootNames,
    options: { ...input.options, noEmit: true, noUncheckedIndexedAccess: true },
  })
  const setup = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()]
  if (setup.length > 0) throw new Error(`program setup failed: ${flatten(setup)}`)
  const isRepositorySource = (file: ts.SourceFile): boolean =>
    !file.isDeclarationFile &&
    !program.isSourceFileFromExternalLibrary(file) &&
    !relative(input.root, file.fileName).startsWith('..')
  const perFile = program
    .getSourceFiles()
    .filter(isRepositorySource)
    .map((file) => {
      const found = program.getSemanticDiagnostics(file).map(formatDiagnostic)
      return [relative(input.root, file.fileName), found] as const
    })
    .filter(([, found]) => found.length > 0)
  return new Map(perFile)
}

export function countsOf(diagnostics: IndexDiagnostics): RatchetCounts {
  return Object.fromEntries([...diagnostics].map(([path, found]) => [path, found.length]))
}

function explainRegressions(
  regressions: readonly RatchetChange[],
  diagnostics: IndexDiagnostics,
): string {
  const listed = regressions.map(({ file, baseline, current }) => {
    const found = diagnostics.get(file) ?? []
    const shown = found.slice(0, SHOWN_PER_FILE).map((line) => `    ${file}:${line}`)
    const more =
      found.length > SHOWN_PER_FILE ? [`    … ${found.length - SHOWN_PER_FILE} more`] : []
    return [`  ${file}: ${baseline} → ${current}`, ...shown, ...more].join('\n')
  })
  return (
    `${listed.join('\n')}\n\n` +
    'With noUncheckedIndexedAccess on, these reads may be undefined. Each file\n' +
    'above lists all its diagnostics, old and new; guard the new reads (`?.`,\n' +
    '`??`, an explicit check). Rewrite the baseline only when a file moved:\n' +
    `  ${WRITE_COMMAND}`
  )
}

function main(args: readonly string[]): number {
  const startedAt = performance.now()
  const diagnostics = collectUncheckedIndexDiagnostics(loadRepositoryProgram(ROOT))
  const current = countsOf(diagnostics)
  const total = Object.values(current).reduce((sum, count) => sum + count, 0)
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(0)
  return runRatchetGate(
    {
      name: 'unchecked-indexed-access',
      baselinePath: BASELINE_PATH,
      writeCommand: WRITE_COMMAND,
      summary: `${total} diagnostic(s) in ${diagnostics.size} file(s), none above the baseline (${seconds}s)`,
      explainRegressions: (regressions) => explainRegressions(regressions, diagnostics),
    },
    current,
    args,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2))
}
