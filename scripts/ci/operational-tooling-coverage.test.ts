import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')

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

  it('runs test-quality checks across script and configuration test roots', () => {
    const testQuality = read('scripts/check-test-quality.mjs')
    for (const root of ['scripts', 'server', '.railway', '.storybook']) {
      expect(testQuality).toContain(`...walk(join(ROOT, '${root}'))`)
    }
  })
})
