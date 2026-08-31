import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(process.cwd(), 'src/contexts/staff', file), 'utf8')

describe('Staff runtime dependency injection', () => {
  it('keeps assignment persistence time composition-owned', () => {
    const repository = read('infrastructure/repositories/staff-assignment.repository.ts')
    expect(repository).not.toMatch(/\bnew Date\s*\(\s*\)/u)
    expect(repository).toMatch(
      /createStaffAssignmentRepository\s*=\s*\(\s*db:\s*Database,\s*clock:\s*Clock/u,
    )
  })
})
