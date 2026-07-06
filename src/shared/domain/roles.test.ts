// Role mapping tests — canonical location next to the canonical definition.
// Tests for toDomainRole/toBetterAuthRole which live in shared/domain/roles.ts.

import { describe, it, expect } from 'vitest'
import { toDomainRole, toBetterAuthRole } from './roles'
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

  it('throws on unknown roles', () => {
    expect(() => toDomainRole('unknown')).toThrow('Unknown better-auth role: unknown')
    expect(() => toDomainRole('')).toThrow('Unknown better-auth role: ')
    expect(() => toDomainRole('custom')).toThrow('Unknown better-auth role: custom')
  })

  it('throws a typed DomainError (not a plain Error) for unknown roles', () => {
    let caught: unknown
    try {
      toDomainRole('owner-x')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(isDomainError(caught)).toBe(true)
    const err = caught as { code: string; context?: Record<string, unknown> }
    expect(err.code).toBe('unknown_role')
    expect(err.context?.value).toBe('owner-x')
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
