// Role mapping tests — canonical location next to the canonical definition.
// Tests for toDomainRole/toBetterAuthRole which live in shared/domain/roles.ts.

import { describe, it, expect } from 'vitest'
import { toDomainRole, toDomainRoleStrict, toBetterAuthRole } from './roles'
import { isDomainError } from './errors'

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

  it('returns null for non-built-in (custom) roles', () => {
    expect(toDomainRole('custom')).toBeNull()
    expect(toDomainRole('content-manager')).toBeNull()
  })

  it('returns null for comma-delimited multi-role strings', () => {
    // better-auth member.role may be comma-delimited. Stage 1 rejects these
    // (resolveTenantContext → 403); Stage 2's dynamic resolver handles them.
    expect(toDomainRole('owner,admin')).toBeNull()
    expect(toDomainRole('member,content-manager')).toBeNull()
  })

  it('returns null for empty / whitespace-only roles', () => {
    expect(toDomainRole('')).toBeNull()
    expect(toDomainRole('   ')).toBeNull()
  })
})

describe('toDomainRoleStrict', () => {
  it('maps built-in roles identically to toDomainRole', () => {
    expect(toDomainRoleStrict('owner')).toBe('AccountAdmin')
    expect(toDomainRoleStrict('admin')).toBe('PropertyManager')
    expect(toDomainRoleStrict('member')).toBe('Staff')
  })

  it('throws a typed unknown_role DomainError for non-built-in roles', () => {
    const cases = ['custom', 'content-manager', 'owner,admin', '']
    for (const value of cases) {
      let caught: unknown
      try {
        toDomainRoleStrict(value)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(Error)
      expect(isDomainError(caught)).toBe(true)
      const err = caught as { code: string; context?: Record<string, unknown> }
      expect(err.code).toBe('unknown_role')
      expect(err.context?.value).toBe(value)
    }
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
