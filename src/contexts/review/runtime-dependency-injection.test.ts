import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REVIEW_ROOT = join(process.cwd(), 'src/contexts/review')

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('Review runtime dependency injection', () => {
  it('keeps wall-clock time and random identifiers composition-owned', () => {
    for (const file of productionFiles(REVIEW_ROOT)) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/\bnew Date\s*\(\s*\)/u)
      expect(source, file).not.toMatch(/\bDate\.now\s*\(/u)
      expect(source, file).not.toMatch(/\b(?:crypto\.)?randomUUID\s*\(/u)
      expect(source, file).not.toMatch(/\bMath\.random\s*\(/u)
    }
  })

  it('requires Review identifiers to be provided by composition', () => {
    const source = readFileSync(join(REVIEW_ROOT, 'build.ts'), 'utf8')
    expect(source).toContain('idGen: () => string')
    expect(source).toContain('snapshotRunIdGen: () => string')
  })
})
