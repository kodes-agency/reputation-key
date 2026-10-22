// CI installs Playwright's system packages only through
// scripts/ci/install-playwright-deps.sh, which gives the apt download a
// deadline and moves to the next Ubuntu mirror once. A bare `playwright
// install-deps` or `install --with-deps` waits on a trickling mirror until the
// job's timeout-minutes, as 12 e2e shards did on 2026-10-22
// (docs/operations/e2e-flake-register.md).
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOWS = resolve(import.meta.dirname, '../../.github/workflows')

const workflows = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/u.test(name))
  .map((name) => ({
    name,
    lines: readFileSync(resolve(WORKFLOWS, name), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#')),
  }))

/** The browser list after `pattern` on each line that has one. */
function browserSets(lines: readonly string[], pattern: RegExp): readonly string[] {
  return lines.flatMap((line) => {
    const browsers = pattern.exec(line)?.[1]
    return browsers === undefined ? [] : [browsers.trim()]
  })
}

describe('Playwright system packages in CI workflows', () => {
  it('are never installed by Playwright directly', () => {
    const unbounded = workflows.flatMap(({ name, lines }) =>
      lines
        .filter((line) => /playwright install(-deps\b|\b.*--with-deps)/u.test(line))
        .map((line) => `${name}: ${line.trim()}`),
    )
    expect(unbounded).toEqual([])
  })

  it('are installed through the bounded script for every browser set a job installs', () => {
    const missing = workflows.flatMap(({ name, lines }) => {
      const scripted = browserSets(lines, /install-playwright-deps\.sh ([a-z ]+)/u)
      return browserSets(lines, /playwright install ([a-z ]+)/u)
        .filter((browsers) => !scripted.includes(browsers))
        .map((browsers) => `${name}: ${browsers}`)
    })
    expect(missing).toEqual([])
  })

  it('has a job that uses the script, so the checks above test something', () => {
    const scripted = workflows.flatMap(({ lines }) =>
      browserSets(lines, /install-playwright-deps\.sh ([a-z ]+)/u),
    )
    expect(scripted).toContain('chromium firefox webkit')
  })
})
