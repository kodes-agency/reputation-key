import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ADR_PATH = join(
  process.cwd(),
  'docs/adr/0052-beta-people-access-attribution-and-manager-responsibility.md',
)

describe('ADR 0052 beta people model authority', () => {
  it('is accepted and pins the independent authorities and Team quarantine', () => {
    expect(existsSync(ADR_PATH)).toBe(true)
    const body = readFileSync(ADR_PATH, 'utf8')

    expect(body).toMatch(/status:\s*accepted/i)
    for (const concept of [
      'StaffParticipant',
      'StaffUserLink',
      'PropertyAccessGrant',
      'PortalResponsibility',
      'PortalResponsibleManager',
      'PropertyResponsibleManager',
      'PortalGroup',
    ]) {
      expect(body).toContain(concept)
    }
    expect(body).toMatch(/multiple eligible managers may be assigned/i)
    expect(body).toMatch(/Team has no beta route/i)
    expect(body).toMatch(/unconditionally blocked[\s\S]*team\.use/i)
    expect(body).toMatch(/does not grant access/i)
  })

  it('keeps invitation access provisioning independent from Staff participation', () => {
    const composition = readFileSync(join(process.cwd(), 'src/composition.ts'), 'utf8')
    const staffBuild = readFileSync(
      join(process.cwd(), 'src/contexts/staff/build.ts'),
      'utf8',
    )

    expect(composition).toContain('grantInvitationPropertyAccess')
    expect(composition).not.toContain('systemStaffParticipation')
    expect(staffBuild).not.toContain('systemStaffParticipation')
  })

  it.each(['staff', 'team'])(
    '%s context keeps required documentation sections in order',
    (context) => {
      const body = readFileSync(
        join(process.cwd(), 'src/contexts', context, 'CONTEXT.md'),
        'utf8',
      )
      const headings = [
        '## Bounded context',
        '## Invariants',
        '## Events produced',
        '## Public API',
      ]
      const positions = headings.map((heading) => body.indexOf(heading))

      expect(positions.every((position) => position >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    },
  )
})
