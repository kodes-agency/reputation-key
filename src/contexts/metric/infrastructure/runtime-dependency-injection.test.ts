import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(process.cwd(), 'src/contexts/metric', file), 'utf8')

const productionFiles = (directory = ''): string[] =>
  readdirSync(join(process.cwd(), 'src/contexts/metric', directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relativePath = join(directory, entry.name)
    if (entry.isDirectory()) return productionFiles(relativePath)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [relativePath]
      : []
  })

describe('Metric runtime dependency injection', () => {
  it('keeps handlers, stores, and jobs independent from ambient runtime state', () => {
    for (const file of productionFiles()) {
      const source = read(file)
      expect(source, file).not.toMatch(/\bgetLogger\s*\(/u)
      expect(source, file).not.toMatch(/\bget(?:Db|Env|Pool|Redis)\s*\(/u)
      expect(source, file).not.toMatch(/\bprocess\.env\b/u)
      expect(source, file).not.toMatch(/\bnew Date\s*\(\s*\)/u)
      expect(source, file).not.toMatch(/\bDate\.now\s*\(/u)
      expect(source, file).not.toMatch(/\brandomUUID\s*\(/u)
      expect(source, file).not.toMatch(/\bMath\.random\s*\(/u)
    }
  })

  it('makes the context build own handler logging', () => {
    const source = read('build.ts')
    expect(source).toContain('logger: LoggerPort')
    expect(source).toContain('logger: input.logger')
  })
})
