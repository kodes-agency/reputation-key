import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPORTING_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTypeScriptFiles(path)
    if (!entry.isFile() || (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')))
      return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return []
    return [path]
  })
}

describe('Reporting runtime dependency injection', () => {
  const productionSources = productionTypeScriptFiles(REPORTING_ROOT).map((file) => ({
    file: relative(REPORTING_ROOT, file),
    source: readFileSync(file, 'utf8'),
  }))

  it.each(productionSources)(
    'keeps ambient runtime state out of $file',
    ({ file, source }) => {
      expect(source, file).not.toMatch(/\bgetLogger\s*\(/u)
      expect(source, file).not.toMatch(/\bget(?:Db|Env|Pool|Redis)\s*\(/u)
      expect(source, file).not.toMatch(/\bprocess\.env\b/u)
      expect(source, file).not.toMatch(/\bnew\s+Date\s*\(\s*\)/u)
      expect(source, file).not.toMatch(/\bDate\.now\s*\(/u)
      expect(source, file).not.toMatch(/\brandomUUID\s*\(/u)
      expect(source, file).not.toMatch(/\bMath\.random\s*\(/u)
    },
  )

  it('keeps the Reporting clock rooted in composition', () => {
    const buildSource = readFileSync(join(REPORTING_ROOT, 'build.ts'), 'utf8')
    const compositionSource = readFileSync(
      join(REPORTING_ROOT, '..', '..', 'composition', 'read-and-notify-contexts.ts'),
      'utf8',
    )

    expect(buildSource).toMatch(/\bclock:\s*\(\)\s*=>\s*Date/u)
    expect(compositionSource).toMatch(
      /buildReportingContext\s*\(\s*\{[\s\S]*?\bclock:\s*input\.clock,[\s\S]*?\}\s*\)/u,
    )
  })
})
