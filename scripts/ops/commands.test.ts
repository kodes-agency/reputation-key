import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GOOGLE_PROVIDER_OPERATOR_COMMANDS } from '../../src/shared/ops/google-provider-commands'
import { COMMANDS } from './commands'

const ROOT = resolve(import.meta.dirname, '../..')

/** Live operator guides. Archived plans and review notes are history. */
const OPERATOR_DOCS = [
  'README.md',
  ...globSync(['docs/operations/**/*.md', 'docs/agents/**/*.md'], { cwd: ROOT }),
]

const INVOCATION = /pnpm ops ([a-z][a-z0-9-]*)/g

describe('pnpm ops command table', () => {
  // README documented `pnpm ops deploy-ci-images` as THE deploy step while
  // the dispatcher had no such entry, so the release command exited 1.
  it('resolves every documented `pnpm ops <name>` invocation', () => {
    const unresolved = OPERATOR_DOCS.flatMap((path) =>
      [...readFileSync(resolve(ROOT, path), 'utf8').matchAll(INVOCATION)]
        .map((match) => match[1])
        .filter((name) => !Object.hasOwn(COMMANDS, name))
        .map((name) => `${path}: pnpm ops ${name}`),
    )
    expect(unresolved).toEqual([])
  })

  it('points every command at a script that exists', () => {
    const missing = Object.entries(COMMANDS)
      .filter(([, [file]]) => !existsSync(resolve(ROOT, file)))
      .map(([name, [file]]) => `${name}: ${file}`)
    expect(missing).toEqual([])
  })
})

// Three commands need a call to Google, which operator commands cannot make,
// so `--apply` on them is refused. The incident runbooks used to tell the
// operator to apply them anyway.
describe('operator commands that only report', () => {
  const REPORT_ONLY = Object.keys(GOOGLE_PROVIDER_OPERATOR_COMMANDS)
  const INVOKED_NAMES = REPORT_ONLY.map((name) => name.slice('ops:'.length))
  const SCRIPTS = INVOKED_NAMES.map((name) => COMMANDS[name]?.[0] ?? `missing:${name}`)

  /** A file with shell continuations folded, so one invocation is one line. */
  const folded = (path: string): string =>
    readFileSync(resolve(ROOT, path), 'utf8').replace(/\\\n\s*/g, ' ')

  it('are never shown with --apply in a guide, the Pub/Sub setup script or their own help', () => {
    // The flag inside the same code span or shell line as the command. Prose
    // such as "`pnpm ops gbp-subscribe` refuses `--apply`" is not an invocation.
    const applied = new RegExp(
      `(?:pnpm ops |ops:)(?:${INVOKED_NAMES.join('|')})\\b[^\`'\\n]*--apply`,
      'g',
    )
    const offenders = [
      ...OPERATOR_DOCS,
      'scripts/ops/gcp-pubsub-setup.sh',
      ...SCRIPTS,
    ].flatMap((path) =>
      [...folded(path).matchAll(applied)].map((match) => `${path}: ${match[0]}`),
    )
    expect(offenders).toEqual([])
  })

  it('never end a report by telling the operator to re-run with --apply', () => {
    const offenders = SCRIPTS.filter((path) =>
      /re-run with[^\n]*--apply/.test(folded(path)),
    )
    expect(offenders).toEqual([])
  })

  it('are named in the incident runbooks only where the passage says --apply is refused', () => {
    const named = new RegExp(`(?:pnpm ops |ops:)(?:${INVOKED_NAMES.join('|')})\\b`)
    // A passage is a block of lines with no blank line in it.
    const passages = readFileSync(
      resolve(ROOT, 'docs/operations/runbooks.md'),
      'utf8',
    ).split(/\n\s*\n/)
    const silent = passages
      .filter((passage) => named.test(passage) && !/refuses\s+`--apply`/.test(passage))
      .map((passage) => passage.slice(0, passage.indexOf('\n')))
    expect(silent).toEqual([])
  })

  it('are marked report only in the command list', () => {
    const entries = readFileSync(
      resolve(ROOT, 'docs/operations/operator-commands.md'),
      'utf8',
    ).split('\n')
    const unmarked = REPORT_ONLY.filter(
      (name) =>
        !entries
          .find((line) => line.startsWith(`- \`${name} `))
          ?.includes('Report only: `--apply` is refused'),
    )
    expect(unmarked).toEqual([])
  })
})
