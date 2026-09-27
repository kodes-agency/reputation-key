import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
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
