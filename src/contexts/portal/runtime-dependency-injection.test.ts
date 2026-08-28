import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PORTAL_ROOT = join(process.cwd(), 'src/contexts/portal')

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : productionFiles(path)
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('Portal runtime dependency injection', () => {
  it('keeps logging, wall-clock time, and random identifiers composition-owned', () => {
    for (const file of productionFiles(PORTAL_ROOT)) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/\bgetLogger\s*\(/u)
      expect(source, file).not.toMatch(/\bnew Date\s*\(\s*\)/u)
      expect(source, file).not.toMatch(/\bDate\.now\s*\(/u)
      expect(source, file).not.toMatch(/\brandomUUID\s*\(/u)
      expect(source, file).not.toMatch(
        /import\s*\{[^}]*\b(?:randomUUID|randomBytes)\b[^}]*\}\s*from\s*['"]node:crypto['"]/su,
      )
    }
  })

  it('requires secure token entropy to be provided by composition', () => {
    const source = readFileSync(
      join(PORTAL_ROOT, 'infrastructure/adapters/portal-token-codec.ts'),
      'utf8',
    )

    expect(source).not.toMatch(/randomBytes\?:/u)
    expect(source).not.toMatch(/\?\?\s*randomBytes/u)
  })
})
