import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const GUEST_ROOT = join(process.cwd(), 'src/contexts/guest')

const read = (file: string): string => readFileSync(join(GUEST_ROOT, file), 'utf8')

const productionFiles = (directory = ''): string[] =>
  readdirSync(join(GUEST_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(directory, entry.name)
    if (entry.isDirectory()) return productionFiles(relativePath)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [relativePath]
      : []
  })

describe('Guest runtime dependency injection', () => {
  it('keeps Guest production code independent from ambient runtime state', () => {
    for (const file of productionFiles()) {
      const source = read(file)
      expect(source, file).not.toMatch(/\bgetLogger\s*\(/u)
      expect(source, file).not.toMatch(/\bget(?:Db|Env|Pool|Redis)\s*\(/u)
      expect(source, file).not.toMatch(/\bprocess\.env\b/u)
      expect(source, file).not.toMatch(/\bnew Date\s*\(\s*\)/u)
      expect(source, file).not.toMatch(/\bDate\.now\b/u)
      expect(source, file).not.toMatch(/\b(?:randomUUID|randomBytes)\b/u)
      expect(source, file).not.toMatch(/\bMath\.random\b/u)
    }
  })

  it('makes the context build own Guest runtime wiring', () => {
    const source = read('build.ts')
    expect(source).toContain('logger: LoggerPort')
    expect(source).toContain('clock: Clock')
    expect(source).toContain('idGen: () => string')
    expect(source).toContain('monotonicNow: () => number')
    expect(source).toContain('publicOrigin: string')
    expect(source).toContain('createGuestNetworkPseudonymHasher')
  })
})
