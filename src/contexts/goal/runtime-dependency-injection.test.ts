import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const GOAL_ROOT = dirname(fileURLToPath(import.meta.url))

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

describe('Goal runtime dependency injection', () => {
  const productionSources = productionTypeScriptFiles(GOAL_ROOT).map((file) => ({
    file,
    source: readFileSync(file, 'utf8'),
  }))

  it.each(productionSources)(
    'keeps ambient logging and time out of $file',
    ({ source }) => {
      expect(source).not.toMatch(
        /import(?:\s+type)?\s*\{[^}]*\bgetLogger\b[^}]*\}\s*from/u,
      )
      expect(source).not.toMatch(/\bgetLogger\s*\(/u)
      expect(source).not.toMatch(/\bDate\.now\s*\(/u)
      expect(source).not.toMatch(/\bnew\s+Date\s*\(\s*\)/u)
    },
  )

  it('keeps the active Goal build clock rooted in composition', () => {
    const buildSource = readFileSync(join(GOAL_ROOT, 'build.ts'), 'utf8')
    // ARC-03-T10: Goal is a leaf context, built by the root's read/notify
    // composition module. The clock is still root-owned and injected.
    const compositionSource = readFileSync(
      join(GOAL_ROOT, '..', '..', 'composition', 'read-and-notify-contexts.ts'),
      'utf8',
    )

    expect(buildSource).toMatch(/\bclock:\s*\(\)\s*=>\s*Date/u)
    expect(compositionSource).toMatch(
      /buildGoalContext\s*\(\s*\{[\s\S]*?\bclock:\s*input\.clock,[\s\S]*?\}\s*\)/u,
    )
  })
})
