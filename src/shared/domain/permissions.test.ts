// Permission lookup — can() typed-error + delegation tests.
// can() lives in shared/domain (no better-auth dependency); the real permission
// table is injected via setPermissionLookup() from shared/auth/permissions.ts.
// These tests cover the uninitialized-table failure path (previously a plain Error,
// now a typed DomainError) and the happy-path delegation.

import { describe, it, expect, afterEach } from 'vitest'
import {
  can,
  setPermissionLookup,
  resetPermissionLookup,
  type Permission,
} from './permissions'
import type { Role } from './roles'
import { isDomainError } from './errors'

afterEach(() => {
  // Restore the module to its uninitialized state so no lookup leaks between suites.
  resetPermissionLookup()
})

describe('can — uninitialized permission table', () => {
  it('throws a typed DomainError (not a plain Error) when the table is not initialized', () => {
    resetPermissionLookup()
    let caught: unknown
    try {
      can('AccountAdmin', 'property.read')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(isDomainError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('permissions_not_initialized')
  })

  it('mentions initPermissionTable() in the message', () => {
    resetPermissionLookup()
    expect(() => can('AccountAdmin', 'property.read')).toThrow(
      'Permission table not initialized',
    )
    expect(() => can('AccountAdmin', 'property.read')).toThrow('initPermissionTable')
  })
})

describe('can — delegation', () => {
  it('delegates to the injected lookup and returns its result', () => {
    const lookup = (role: Role, permission: Permission): boolean =>
      role === 'AccountAdmin' && permission === 'property.read'
    setPermissionLookup(lookup)

    expect(can('AccountAdmin', 'property.read')).toBe(true)
    expect(can('Staff', 'property.read')).toBe(false)
    expect(can('AccountAdmin', 'property.delete')).toBe(false)
  })
})
