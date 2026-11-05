import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(process.cwd(), 'src/contexts/feed', file), 'utf8')

describe('Activity runtime dependency injection', () => {
  it('keeps repository logging caller-owned', () => {
    expect(read('infrastructure/recent-activity-repository.drizzle.ts')).not.toMatch(
      /\bgetLogger\s*\(/u,
    )
  })

  it('requires composition-owned Operational Action History identifiers', () => {
    const build = read('build.ts')
    expect(build).not.toMatch(/(?:crypto\.)?randomUUID/u)
    expect(build).toContain(
      'operationalHistoryIdGen: () => OperationalActionHistoryRecordId',
    )
    expect(build).toContain('operationalHistoryHoldIdGen: () => string')
  })
})
