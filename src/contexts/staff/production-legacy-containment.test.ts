import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('legacy StaffAssignment production containment', () => {
  it('keeps the retained repository out of Staff build and production composition', () => {
    const build = readFileSync(join(root, 'src/contexts/staff/build.ts'), 'utf8')
    const composition = readFileSync(join(root, 'src/composition.ts'), 'utf8')

    expect(build).not.toMatch(/StaffAssignmentRepository|staffAssignmentRepo/u)
    expect(composition).not.toMatch(
      /createStaffAssignmentRepository|createIdentityMembershipAdapter/u,
    )
  })
})
