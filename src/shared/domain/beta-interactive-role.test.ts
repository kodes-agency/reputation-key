import { describe, expect, it } from 'vitest'
import {
  isBetaInteractiveMemberRoleToken,
  isBetaInteractiveRole,
  isGrantScopedRole,
} from './beta-interactive-role'

describe('closed-beta interactive roles', () => {
  it.each(['AccountAdmin', 'PropertyManager'] as const)('allows %s', (role) => {
    expect(isBetaInteractiveRole(role)).toBe(true)
  })

  it('keeps Member as a non-interactive business role', () => {
    expect(isBetaInteractiveRole('Member')).toBe(false)
  })

  it.each([
    ['AccountAdmin', false],
    ['PropertyManager', true],
  ] as const)('reports whether %s is limited to granted Properties', (role, expected) => {
    expect(isGrantScopedRole(role)).toBe(expected)
  })

  it.each(['owner', 'OWNER', ' admin '])('allows Better Auth token %j', (role) => {
    expect(isBetaInteractiveMemberRoleToken(role)).toBe(true)
  })

  it.each(['member', 'content-manager', 'owner,admin', ''])(
    'rejects Better Auth token %j',
    (role) => {
      expect(isBetaInteractiveMemberRoleToken(role)).toBe(false)
    },
  )
})
