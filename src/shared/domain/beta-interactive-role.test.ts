import { describe, expect, it } from 'vitest'
import {
  isBetaInteractiveMemberRoleToken,
  isBetaInteractiveRole,
} from './beta-interactive-role'

describe('closed-beta interactive roles', () => {
  it.each(['AccountAdmin', 'PropertyManager'] as const)('allows %s', (role) => {
    expect(isBetaInteractiveRole(role)).toBe(true)
  })

  it('keeps Staff as a non-interactive business role', () => {
    expect(isBetaInteractiveRole('Staff')).toBe(false)
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
