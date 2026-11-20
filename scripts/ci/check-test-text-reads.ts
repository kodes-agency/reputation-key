// Text-reading test gate (docs/rules.md, rules 29 and 34).
//
// WHAT. Walks every test file outside `src/shared/architecture/` and
// `scripts/ci/` and counts the places where it reads the repository as text:
// `readFileSync`, `readFile`, `readdirSync`, `readdir`, `globSync`, `glob`,
// `import.meta.glob` and imports with `?raw`. A count may not rise above its
// entry in text-reads.baseline.json, and a file without an entry may hold none.
// Reading data that sits beside the test (a JSON vector, an SQL fixture, a
// picture) or a temporary directory the test made is not counted.
//
// WHY. A test that reads source, documents or configuration as text asserts
// how the code is written, not what it does, and breaks on a rename. The
// invariants such a test guards belong in a lint rule or in the architecture
// suite, which is why those two places are exempt.
//
// WHY A GATE (rule 34). It extends the ratchet the layout gate already uses
// (ratchet-baseline.ts) and adds no tool.
//
// UPDATING THE BASELINE. `pnpm check:test-text-reads --write-baseline` after
// deleting or rewriting an offender. The command refuses to raise an entry or
// to add one.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEntryPoint } from './entry-point'
import {
  compareWithBaseline,
  formatChanges,
  parseBaseline,
  runRatchetGate,
  type RatchetChange,
  type RatchetCounts,
} from './ratchet-baseline'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BASELINE_PATH = resolve(ROOT, 'scripts/ci/text-reads.baseline.json')
const WRITE_COMMAND = 'pnpm check:test-text-reads --write-baseline'

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u
const EXEMPT_FOLDERS = ['src/shared/architecture/', 'scripts/ci/']
const SKIPPED_FOLDERS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'storybook-static',
])
const READ_CALL =
  /\b(?:readFileSync|readFile|readdirSync|readdir|globSync|glob|import\.meta\.glob(?:<[^(]*>)?)\s*\(/gu
const RAW_IMPORT = /\?raw['"`]/gu
// Reads of something the test made, or of data kept beside the test.
const FIXTURE_ARGUMENT =
  /fixture|testdata|test-data|tmpdir|mkdtemp|\btmp|\btemp|scratch|['"`]\.{0,2}\/?[\w-]+\.(?:sql|csv|jsonl|ndjson|txt|png|jpe?g|webp|pdf)['"`]/iu
const BESIDE_JSON = /['"`]\.{0,2}\/?(?!package|tsconfig|components)[\w-]+\.json['"`]/u

/** Source with whole-line comments removed, so a comment that names a call does not count. */
function withoutComments(source: string): string {
  return source.replace(/^\s*\/\*[\s\S]*?\*\//gmu, '').replace(/^\s*\/\/.*$/gmu, '')
}

/** The text of a call's arguments, up to its closing parenthesis. */
function argumentsFrom(source: string, open: number): string {
  let depth = 1
  let end = open
  while (end < source.length && depth > 0) {
    const char = source[end]
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    end += 1
  }
  return source.slice(open, end)
}

/** Places a test source reads the repository as text. */
export function countTextReads(source: string): number {
  const code = withoutComments(source)
  const calls = [...code.matchAll(READ_CALL)].filter((match) => {
    const args = argumentsFrom(code, match.index + match[0].length)
    return !FIXTURE_ARGUMENT.test(args) && !BESIDE_JSON.test(args)
  })
  return calls.length + [...code.matchAll(RAW_IMPORT)].length
}

export function isCheckedTest(file: string): boolean {
  return TEST_FILE.test(file) && !EXEMPT_FOLDERS.some((folder) => file.startsWith(folder))
}

/** Every test file under the checkout, as a repository path with forward slashes. */
export function listTestFiles(root: string): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(join(root, directory), { withFileTypes: true })
      .filter((entry) => !SKIPPED_FOLDERS.has(entry.name))
      .filter((entry) => !entry.name.startsWith('.') || entry.name === '.storybook')
      .flatMap((entry) => {
        const path = directory === '' ? entry.name : `${directory}/${entry.name}`
        return entry.isDirectory() ? walk(path) : [path]
      })
  return walk('').filter(isCheckedTest)
}

export function textReadCounts(root: string): RatchetCounts {
  const counts: Record<string, number> = {}
  for (const file of listTestFiles(root)) {
    const count = countTextReads(readFileSync(join(root, file), 'utf8'))
    if (count > 0) counts[file] = count
  }
  return counts
}

export function explainTextReadRegressions(
  regressions: readonly RatchetChange[],
): string {
  return (
    `${formatChanges(regressions)}\n\n` +
    'A test does not read source, documents or configuration as text. Test what the\n' +
    'code does. A rule about how code is written is a lint rule, or a check in\n' +
    'src/shared/architecture/ or scripts/ci/. Data kept beside the test (a JSON\n' +
    'vector, an SQL fixture) and files the test creates are fine.'
  )
}

export type TextReadCheckout = Readonly<{ root: string; baselinePath: string }>

/** Check, or rewrite the baseline downwards; returns the process exit code. */
export function runTextReadGate(
  args: readonly string[],
  at: TextReadCheckout = { root: ROOT, baselinePath: BASELINE_PATH },
): number {
  const current = textReadCounts(at.root)
  if (args.includes('--write-baseline') && existsSync(at.baselinePath)) {
    const baseline = parseBaseline(readFileSync(at.baselinePath, 'utf8'))
    const { regressions } = compareWithBaseline(baseline, current)
    if (regressions.length > 0) {
      process.stderr.write(
        `[test-text-reads] FAILED — the baseline is not rewritten upwards; ${regressions.length} path(s) rose:\n` +
          `${explainTextReadRegressions(regressions)}\n`,
      )
      return 1
    }
  }
  const reads = Object.values(current).reduce((sum, count) => sum + count, 0)
  return runRatchetGate(
    {
      name: 'test-text-reads',
      baselinePath: at.baselinePath,
      writeCommand: WRITE_COMMAND,
      summary: `${reads} read(s) in ${Object.keys(current).length} test file(s) that may only shrink, none above the baseline`,
      explainRegressions: explainTextReadRegressions,
    },
    current,
    args,
  )
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = runTextReadGate(process.argv.slice(2))
}
