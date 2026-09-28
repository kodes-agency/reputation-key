// File-length ratchet (code-health-06).
//
// WHAT. Counts the lines of every production TypeScript module in SCOPE exactly
// as ESLint's `max-lines` rule does with `skipBlankLines` and `skipComments`
// (the unit test pins this against ESLint itself): a line counts when it holds
// any code; blank and comment-only lines do not. A module past MAX_LINES fails
// unless file-length.baseline.json grandfathers it, and a grandfathered module
// fails as soon as it grows past its recorded count.
//
// WHY. The owner's coding standard caps a file at 800 lines, but only
// src/components had a gate. When this landed, 33 modules elsewhere were past
// 800 counted lines — the largest at 2,778 — and nothing stopped the next one.
// This stops growth without a big-bang split: the baseline only moves down, one
// split at a time.
//
// SCOPE. src/contexts, src/shared, src/routes, scripts and server; tests,
// stories, generated code and src/routeTree.gen.ts are out. src/components is
// out on purpose: eslint.config.js already holds it to a stricter 300 counted
// lines, and that block's exemptions (shadcn/ui primitives and two small
// feature files) are deliberate.
//
// UPDATING THE BASELINE. `pnpm check:file-length --write-baseline`, then commit
// the JSON — when a grandfathered module shrinks (the gate passes and asks for
// this), is split below the limit, or moves. Do not raise an entry to get a
// change through; split the module. The baseline diff is reviewed.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { formatChanges, runRatchetGate, type RatchetCounts } from './ratchet-baseline'

export const MAX_LINES = 800

const SCOPE = ['src/contexts', 'src/shared', 'src/routes', 'scripts', 'server'] as const

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BASELINE_PATH = resolve(ROOT, 'scripts/ci/file-length.baseline.json')
const WRITE_COMMAND = 'pnpm check:file-length --write-baseline'

const TYPESCRIPT_MODULE = /\.tsx?$/
const NOT_PRODUCTION = /\.(test|spec|stories)\./
// ESLint splits lines on CRLF, CR, LF, U+2028 and U+2029.
const LINE_BREAK = /\r\n|[\r\n\p{Zl}\p{Zp}]/u
const NOT_LINE_BREAK = /[^\r\n\p{Zl}\p{Zp}]/gu
const HAS_CODE = /\S/

export function isProductionModule(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return (
    TYPESCRIPT_MODULE.test(name) &&
    !NOT_PRODUCTION.test(name) &&
    !path.split('/').includes('generated') &&
    path !== 'src/routeTree.gen.ts'
  )
}

/** Repository-relative production modules under SCOPE, sorted. */
function discoverModules(root: string): readonly string[] {
  const modules: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(path)
      else if (entry.isFile() && isProductionModule(path)) modules.push(path)
    }
  }
  for (const directory of SCOPE) {
    if (existsSync(join(root, directory))) walk(directory)
  }
  return modules.sort()
}

// Tokens whose text may contain `//` or `/*` without being a comment.
const OPAQUE_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
])

type Range = readonly [start: number, end: number]

function opaqueRanges(sourceFile: ts.SourceFile): readonly Range[] {
  const ranges: Range[] = []
  const visit = (node: ts.Node): void => {
    if (OPAQUE_TOKENS.has(node.kind)) {
      // JSX text cannot hold a comment, so all of it is opaque, leading blanks included.
      ranges.push([ts.isJsxText(node) ? node.pos : node.getStart(sourceFile), node.end])
    } else {
      ts.forEachChild(node, visit)
    }
  }
  visit(sourceFile)
  return ranges.sort((left, right) => left[0] - right[0])
}

function lineEnd(text: string, from: number): number {
  const offset = text.slice(from).search(LINE_BREAK)
  return offset === -1 ? text.length : from + offset
}

function blockCommentEnd(text: string, from: number): number {
  const close = text.indexOf('*/', from + 2)
  return close === -1 ? text.length : close + 2
}

/** Comments in text[from, to), a stretch that holds no string, template, regex or JSX text. */
function commentsBetween(text: string, from: number, to: number): readonly Range[] {
  const comments: Range[] = []
  let slash = text.indexOf('/', from)
  while (slash !== -1 && slash < to) {
    const next = text[slash + 1]
    if (next === '/' || next === '*') {
      const end = next === '/' ? lineEnd(text, slash) : blockCommentEnd(text, slash)
      comments.push([slash, end])
      slash = text.indexOf('/', end)
    } else {
      slash = text.indexOf('/', slash + 1)
    }
  }
  return comments
}

/** Comment ranges, found only between opaque tokens. A shebang counts, as for ESLint. */
function commentRanges(text: string, opaque: readonly Range[]): readonly Range[] {
  const shebang: readonly Range[] = text.startsWith('#!') ? [[0, lineEnd(text, 0)]] : []
  const gaps: Range[] = []
  let cursor = shebang.length > 0 ? lineEnd(text, 0) : 0
  for (const [start, end] of opaque) {
    gaps.push([cursor, start])
    cursor = end
  }
  gaps.push([cursor, text.length])
  return [...shebang, ...gaps.flatMap(([from, to]) => commentsBetween(text, from, to))]
}

/** Lines holding code, as ESLint `max-lines` counts with skipBlankLines + skipComments. */
export function countCodeLines(fileName: string, text: string): number {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    {
      languageVersion: ts.ScriptTarget.Latest,
      jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
    },
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  // Blank every comment character except line breaks; what is left on a line is code.
  let code = ''
  let cursor = 0
  for (const [start, end] of commentRanges(text, opaqueRanges(sourceFile))) {
    const blanked = text.slice(start, end).replace(NOT_LINE_BREAK, ' ')
    code += text.slice(cursor, start) + blanked
    cursor = end
  }
  code += text.slice(cursor)
  return code.split(LINE_BREAK).filter((line) => HAS_CODE.test(line)).length
}

/** Modules past MAX_LINES, with their counted lines. */
export function measureFileLengths(root: string): RatchetCounts {
  const lengths = discoverModules(root).map((path) => {
    const lines = countCodeLines(path, readFileSync(join(root, path), 'utf8'))
    return [path, lines] as const
  })
  return Object.fromEntries(lengths.filter(([, lines]) => lines > MAX_LINES))
}

function main(args: readonly string[]): number {
  const current = measureFileLengths(ROOT)
  return runRatchetGate(
    {
      name: 'file-length',
      baselinePath: BASELINE_PATH,
      writeCommand: WRITE_COMMAND,
      summary: `${Object.keys(current).length} grandfathered module(s) past ${MAX_LINES} counted lines, none grew`,
      explainRegressions: (regressions) =>
        `${formatChanges(regressions)}\n\n` +
        `A production module may have at most ${MAX_LINES} counted lines (blank and\n` +
        'comment-only lines are free); a grandfathered one may not grow. Split the\n' +
        'module along its responsibilities. Rewrite the baseline only when a\n' +
        `grandfathered module moved: ${WRITE_COMMAND}`,
    },
    current,
    args,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2))
}
