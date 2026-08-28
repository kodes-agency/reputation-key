import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(process.cwd(), 'src/contexts/team', file), 'utf8')

describe('Team retained-runtime dependency injection', () => {
  it('keeps reconciliation evidence timestamps caller-owned', () => {
    const repository = read(
      'infrastructure/repositories/reconcile-people-team.repository.ts',
    )

    expect(repository).not.toMatch(/\bnew Date\(\)/u)
    expect(repository).toContain('clock: Clock')
    expect(repository).toContain('generatedAt: clock()')
    expect(repository).toContain('checkedAt: clock()')
  })
})
