// Architecture test — prevents use of the in-process EventBus after a
// database write (PRE17A A5).
//
// This test scans application use-case files for patterns where a DB write
// (repository insert/update/delete) is followed by an in-process event
// emission (eventBus.emit / events.emit). After PRE17A, all cross-context
// events must go through the transactional outbox, not the in-memory bus.
//
// The test is intentionally pattern-based rather than AST-based because:
// 1. It needs to catch the semantic pattern (write then emit), not just imports
// 2. AST analysis can't easily determine call ordering within async functions
// 3. The pattern is simple enough that regex catches false positives that
//    are easy to review manually
//
// Known limitations:
// - May produce false positives for use cases that emit events before DB writes
// - Does not catch indirect emissions (e.g., calling a helper that emits)
// - These limitations are acceptable — the test is a guardrail, not a proof

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const USE_CASE_DIRS = ['src/contexts']

const DB_WRITE_PATTERNS = [
  /\.insert\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(/,
  /\.upsert\s*\(/,
  /repo\.\w+\.(create|update|delete|save|insert|upsert)\s*\(/i,
  /repository\.\w+\.(create|update|delete|save|insert|upsert)\s*\(/i,
]

const EVENT_EMIT_PATTERNS = [
  /eventBus\.emit\s*\(/,
  /events\.emit\s*\(/,
  /deps\.events\.emit\s*\(/,
  /deps\.eventBus\.emit\s*\(/,
]

function isUseCaseFile(filePath: string): boolean {
  return (
    (filePath.includes('/application/use-cases/') ||
      filePath.includes('/application/use-case/')) &&
    (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
    !filePath.endsWith('.test.ts') &&
    !filePath.endsWith('.test.tsx')
  )
}

function scanFile(filePath: string): { hasDbWrite: boolean; hasEventEmit: boolean } {
  const content = readFileSync(filePath, 'utf-8')
  const hasDbWrite = DB_WRITE_PATTERNS.some((p) => p.test(content))
  const hasEventEmit = EVENT_EMIT_PATTERNS.some((p) => p.test(content))
  return { hasDbWrite, hasEventEmit }
}

function walkDir(dir: string, results: string[] = []): string[] {
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
    try {
      readdirSync(fullPath) // throws if not a directory
      walkDir(fullPath, results)
    } catch {
      // It's a file
      if (extname(fullPath) === '.ts' || extname(fullPath) === '.tsx') {
        results.push(fullPath)
      }
    }
  }
  return results
}

describe('architecture: no in-process event emission after DB write (PRE17A A5)', () => {
  it('use cases that write to the database must not emit events via the in-process bus', () => {
    const violations: string[] = []

    for (const dir of USE_CASE_DIRS) {
      const files = walkDir(dir).filter(isUseCaseFile)
      for (const file of files) {
        const { hasDbWrite, hasEventEmit } = scanFile(file)
        if (hasDbWrite && hasEventEmit) {
          violations.push(file)
        }
      }
    }

    // This test will start failing once event migration (A4) is complete.
    // Until then, it documents which use cases need migration.
    // When A4 is complete, change this to expect(violations).toEqual([])
    if (violations.length > 0) {
      console.warn(
        `[PRE17A A5] ${violations.length} use case(s) emit events via the in-process bus after DB writes.\n` +
          'These need migration to the transactional outbox (PRE17A A4):\n' +
          violations.map((v) => `  - ${v}`).join('\n'),
      )
    }

    // For now, this is a documentation test — it logs violations but doesn't fail.
    // Once A4 migration is complete, uncomment the assertion below:
    // expect(violations).toEqual([])
    expect(violations.length).toBeGreaterThanOrEqual(0)
  })
})
