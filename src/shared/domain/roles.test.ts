// Role mapping tests — canonical location next to the canonical definition.
// Tests for toDomainRole/toBetterAuthRole which live in shared/domain/roles.ts.

import { describe, it, expect } from 'vitest'
import { toDomainRole, toBetterAuthRole } from './roles'

describe('toDomainRole', () => {
  it('maps better-auth owner to AccountAdmin', () => {
    expect(toDomainRole('owner')).toBe('AccountAdmin')
  })

  it('maps better-auth admin to PropertyManager', () => {
    expect(toDomainRole('admin')).toBe('PropertyManager')
  })

  it('maps better-auth member to Staff', () => {
    expect(toDomainRole('member')).toBe('Staff')
  })

  it('maps unknown roles to Staff', () => {
    expect(toDomainRole('unknown')).toBe('Staff')
    expect(toDomainRole('')).toBe('Staff')
    expect(toDomainRole('custom')).toBe('Staff')
  })
})

describe('toBetterAuthRole', () => {
  it('maps AccountAdmin to owner', () => {
    expect(toBetterAuthRole('AccountAdmin')).toBe('owner')
  })

  it('maps PropertyManager to admin', () => {
    expect(toBetterAuthRole('PropertyManager')).toBe('admin')
  })

  it('maps Staff to member', () => {
    expect(toBetterAuthRole('Staff')).toBe('member')
  })

  it('round-trips correctly', () => {
    const domainRoles = ['AccountAdmin', 'PropertyManager', 'Staff'] as const
    for (const role of domainRoles) {
      expect(toDomainRole(toBetterAuthRole(role))).toBe(role)
    }
  })
})
