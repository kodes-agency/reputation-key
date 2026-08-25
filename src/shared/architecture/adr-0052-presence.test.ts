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
})
