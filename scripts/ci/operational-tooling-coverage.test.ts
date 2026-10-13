import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')

/**
 * ARC-03-T1: the architectural boundary config object is the one that owns
 * `boundaries/elements`. Slicing it out of the source keeps the assertion
 * about THAT block's `files` glob rather than the unrelated Node-globals
 * block, which already carried a `scripts/**` glob before this task.
 */
function boundaryConfigBlock(): string {
  const source = read('eslint.config.js')
  const anchor = source.indexOf("'boundaries/elements'")
  expect(anchor).toBeGreaterThan(-1)
  const blockStart = source.lastIndexOf('\n  {\n', anchor)
  return source.slice(blockStart, anchor)
}

async function ruleSeverity(file: string, rule: string): Promise<number> {
  const eslint = new ESLint({ cwd: ROOT })
  const config = (await eslint.calculateConfigForFile(resolve(ROOT, file))) as {
    rules?: Record<string, [number, ...unknown[]]>
  }
  const entry = config.rules?.[rule]
  return entry ? entry[0] : 0
}

const fallowConfig = JSON.parse(read('.fallowrc.json')) as {
  entry: string[]
  ignorePatterns: string[]
  ignoreExports: { file: string; exports: string[] }[]
}

/** One path segment of a Fallow `ignoreExports` pattern; `*` stays inside the segment. */
function segmentMatcher(segment: string): RegExp {
  const literal = segment.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`^${literal.replaceAll('*', '[^/]*')}$`, 'u')
}

/** The repository files an `ignoreExports` pattern names. */
function filesMatching(pattern: string): readonly string[] {
  const segments = pattern.split('/')
  return segments.reduce<readonly string[]>(
    (directories, segment, index) => {
      const matcher = segmentMatcher(segment)
      const wantsFile = index === segments.length - 1
      return directories
        .filter((directory) => existsSync(resolve(ROOT, directory)))
        .flatMap((directory) =>
          readdirSync(resolve(ROOT, directory), { withFileTypes: true })
            .filter((entry) => matcher.test(entry.name) && entry.isFile() === wantsFile)
            .map((entry) => join(directory, entry.name)),
        )
    },
    [''],
  )
}

/** Names an `ignoreExports` entry lists that none of its files mentions any more. */
function goneExports(entry: { file: string; exports: string[] }): readonly string[] {
  const sources = filesMatching(entry.file).map(read)
  return entry.exports
    .filter(
      (name) => !sources.some((source) => new RegExp(`\\b${name}\\b`, 'u').test(source)),
    )
    .map((name) => `${entry.file}: ${name}`)
}

describe('operational tooling quality coverage', () => {
  it('keeps scripts in ESLint and Fallow analysis', () => {
    const eslint = read('eslint.config.js')
    expect(eslint).not.toContain("      'scripts/**',")
    expect(eslint).toContain("files: ['scripts/**/*.{ts,mjs}']")
    expect(fallowConfig.ignorePatterns).not.toContain('scripts/**')
  })

  // A name Fallow is told to ignore keeps suppressing after the export is
  // deleted: Fallow reports no stale entry for it, and the next unused export
  // that reuses the name in a file the pattern matches is hidden. A pattern
  // with `*` across contexts made 27 of 34 names dead this way (R1A-06).
  it('ignores no Fallow export name that its files no longer mention', () => {
    expect(fallowConfig.ignoreExports.flatMap(goneExports)).toEqual([])
  })

  it('names each context public interface by its own path in Fallow ignoreExports', () => {
    const acrossContexts = fallowConfig.ignoreExports
      .map(({ file }) => file)
      .filter((file) => file.includes('*') && file.endsWith('/public-api.ts'))
    expect(acrossContexts).toEqual([])
  })

  it('puts scripts under eslint-plugin-boundaries', () => {
    expect(boundaryConfigBlock()).toContain("'scripts/**/*.{ts,mjs}'")
  })

  it('keeps every script classified — boundaries/no-unknown-files stays on', async () => {
    // 2 === "error". A script that no element pattern matches must fail the
    // lint, otherwise it silently escapes the dependency policy entirely.
    await expect(
      ruleSeverity(
        'scripts/ops/recover-recent-activity.ts',
        'boundaries/no-unknown-files',
      ),
    ).resolves.toBe(2)
  })

  it('enforces the boundary dependency policy on production scripts', async () => {
    await expect(
      ruleSeverity('scripts/ops/recover-recent-activity.ts', 'boundaries/dependencies'),
    ).resolves.toBe(2)
  })

  it('runs test-quality checks across script and configuration test roots', () => {
    const testQuality = read('scripts/check-test-quality.mjs')
    for (const root of ['scripts', 'server', '.storybook']) {
      expect(testQuality).toContain(`...walk(join(ROOT, '${root}'))`)
    }
  })
})
