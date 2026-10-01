import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every working-copy change opens a pending-change fence AND writes a page-edit
// ledger row. `recordPortalContentChange` does both, so the fence function must
// have exactly one caller: a write that called it directly would leave the
// History without who made the change.

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('page-edit ledger coverage', () => {
  it('lets only recordPortalContentChange open a pending-change fence', () => {
    const root = join(process.cwd(), 'src')
    const callers = sourceFiles(root)
      .filter((file) =>
        /\brecordPortalPendingContentChange\b/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => file.slice(root.length + 1))
      .sort()

    expect(callers).toEqual([
      'contexts/portal/infrastructure/portal-page-edits.ts',
      'contexts/portal/infrastructure/portal-pending-content-changes.ts',
    ])
  })
})
