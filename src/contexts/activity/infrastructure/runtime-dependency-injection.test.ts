import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(process.cwd(), 'src/contexts/activity', file), 'utf8')

describe('Activity runtime dependency injection', () => {
  it('keeps repository and job logging caller-owned', () => {
    for (const file of [
      'infrastructure/recent-activity-repository.drizzle.ts',
      'infrastructure/jobs/project-recent-activity.job.ts',
    ]) {
      expect(read(file), file).not.toMatch(/\bgetLogger\s*\(/u)
    }
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
