#!/usr/bin/env node
// The file-length, test-quality and component/server gates run as ESLint
// rules, so an inline disable would switch one off without a trace. This
// check fails on any such disable, including a bare one that silences every
// rule. Change the rule, the baseline or the code instead.

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u
// Generated output, exempt from the same gates in eslint-rules/file-length.mjs.
const GENERATED = /(?:^|\/)generated\/|(?:^|\/)routeTree\.gen\.ts$/u
const DIRECTIVE = /^\s*eslint-disable(?:-next-line|-line)?(?=\s|$)([^]*)$/u

export function isGuardedRule(rule) {
  return (
    rule === 'max-lines' ||
    rule === 'source-policy/component-server' ||
    rule.startsWith('test-quality/')
  )
}

/** The disable directives in `source` that touch a guarded rule, as line numbers and text. */
export function findGuardedDisables(source) {
  const found = []
  if (!source.includes('eslint-disable')) return found
  const { ast } = tseslint.parser.parseForESLint(source, {
    comment: true,
    loc: true,
    range: true,
    ecmaFeatures: { jsx: true },
  })
  for (const comment of ast.comments ?? []) {
    const match = DIRECTIVE.exec(comment.value)
    if (!match) continue
    const list = (match[1] ?? '').split(/\s-{2,}\s/u)[0] ?? ''
    const rules = list
      .split(',')
      .map((rule) => rule.trim().replace(/^(['"])(.*)\1$/su, '$2'))
      .filter(Boolean)
    if (rules.length === 0 || rules.some(isGuardedRule)) {
      found.push({ line: comment.loc.start.line, text: source.slice(...comment.range) })
    }
  }
  return found
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((file) => SOURCE_FILE.test(file) && !GENERATED.test(file))
}

function main() {
  const failures = trackedFiles().flatMap((file) =>
    findGuardedDisables(readFileSync(file, 'utf8')).map(
      ({ line, text }) => `  ${file}:${line}  ${text}`,
    ),
  )
  if (failures.length > 0) {
    process.stderr.write(
      `[lint-suppressions] FAILED — inline disable of max-lines, test-quality/* or source-policy/component-server (or of every rule):\n${failures.join('\n')}\n`,
    )
    process.exit(1)
  }
  process.stdout.write('[lint-suppressions] OK — no inline disable of a guarded gate\n')
}

const startedScript = process.argv[1]
if (
  startedScript !== undefined &&
  realpathSync(startedScript) === realpathSync(fileURLToPath(import.meta.url))
)
  main()
