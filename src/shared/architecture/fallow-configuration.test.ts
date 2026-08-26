import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type FallowConfig = Readonly<{
  ignorePatterns: readonly string[]
  boundaries: Readonly<{
    zones: ReadonlyArray<Readonly<{ name: string; patterns: readonly string[] }>>
  }>
}>

const ROOT = process.cwd()
const config = JSON.parse(
  readFileSync(join(ROOT, '.fallowrc.json'), 'utf8'),
) as FallowConfig
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

describe('Fallow configuration', () => {
  it('does not claim boundary coverage for ignored source trees', () => {
    for (const zone of config.boundaries.zones) {
      for (const pattern of zone.patterns) {
        expect(
          config.ignorePatterns,
          `${zone.name} ignores its own ${pattern}`,
        ).not.toContain(pattern)
      }
    }
  })

  it('keeps exact container command assertions parseable as shell commands', () => {
    expect(ci).not.toMatch(/=\s*'\["node","[^"\n]+\.js"\]'/u)
  })
})
