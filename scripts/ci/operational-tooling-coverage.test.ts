import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
}

const DYNAMIC_SCRIPT_ENTRIES = [
  'scripts/beta/run-product-journeys.ts',
  'scripts/beta/verify-gate-evidence.ts',
  'scripts/google-import-final-schema-probe.ts',
  'scripts/local-stack/provision-ai-admission-role.ts',
  'scripts/verify-ai-runtime-image.mjs',
] as const

describe('operational tooling quality coverage', () => {
  it('keeps scripts in ESLint and Fallow analysis', () => {
    const eslint = read('eslint.config.js')
    expect(eslint).not.toContain("      'scripts/**',")
    expect(eslint).toContain("files: ['scripts/**/*.{ts,mjs}']")
    expect(fallowConfig.ignorePatterns).not.toContain('scripts/**')
  })

  it('declares dynamically invoked and bundled scripts as Fallow entry points', () => {
    for (const entry of DYNAMIC_SCRIPT_ENTRIES) {
      expect(fallowConfig.entry).toContain(entry)
    }
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
