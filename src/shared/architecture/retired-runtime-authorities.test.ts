import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const RETIRED_AUTHORITIES = [
  'src/shared/jobs/contracts.ts',
  'src/shared/jobs/policies.ts',
  'src/shared/jobs/runtime.ts',
  'src/shared/jobs/runtime.test.ts',
  'src/shared/projections/projection-contract.ts',
  'src/shared/projections/projection-contract.test.ts',
] as const

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('retired runtime authorities stay contracted', () => {
  it('retains only the executable job catalogue and context-owned projections', () => {
    expect(RETIRED_AUTHORITIES.filter((path) => existsSync(join(ROOT, path)))).toEqual([])
  })

  it('does not reintroduce imports of the retired job or projection authorities', () => {
    const retiredImports = [
      /from\s+['"]#\/shared\/jobs\/runtime['"]/,
      /from\s+['"]#\/shared\/jobs\/contracts['"]/,
      /from\s+['"]#\/shared\/jobs\/policies['"]/,
      /from\s+['"]#\/shared\/projections\/projection-contract['"]/,
    ]
    const violations = sourceFiles(SRC)
      .filter((path) => path !== __filename)
      .flatMap((path) => {
        const body = readFileSync(path, 'utf8')
        return retiredImports
          .filter((pattern) => pattern.test(body))
          .map((pattern) => `${relative(ROOT, path)}: ${pattern.source}`)
      })

    expect(violations).toEqual([])
  })
})
