// AuthContext helper tests — canForContext + scopeForPermission (DAC Stage 2 foundation).
// Verifies the additive fallback (uses role when the dynamic fields are absent) and
// the populated path (uses the dynamic fields when present).

import { describe, it, expect, afterEach } from 'vitest'
import {
  canForContext,
  scopeForPermission,
  setPermissionLookup,
  resetPermissionLookup,
  type Permission,
} from './permissions'
import type { AuthContext } from './auth-context'
import type { DataScope } from './data-scope'
import { userId, organizationId } from './ids'

afterEach(() => {
  resetPermissionLookup()
})

const ctx = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'AccountAdmin',
  ...overrides,
})

describe('canForContext', () => {
  it('falls back to can(role, p) when effectivePermissions is absent', () => {
    setPermissionLookup((role, p) => role === 'AccountAdmin' && p === 'property.read')

    expect(canForContext(ctx({ role: 'AccountAdmin' }), 'property.read')).toBe(true)
    expect(canForContext(ctx({ role: 'Staff' }), 'property.read')).toBe(false)
  })

  it('uses effectivePermissions when present (ignores the role table)', () => {
    setPermissionLookup(() => false) // role table says no for everything
    const perms = new Set<Permission>(['property.read'])

    expect(
      canForContext(ctx({ role: 'Staff', effectivePermissions: perms }), 'property.read'),
    ).toBe(true)
    expect(
      canForContext(
        ctx({ role: 'Staff', effectivePermissions: perms }),
        'property.delete',
      ),
    ).toBe(false)
  })
})

describe('scopeForPermission', () => {
  it('falls back to the built-in role scope when scopeByPermission is absent', () => {
    expect(scopeForPermission(ctx({ role: 'AccountAdmin' }), 'property.read')).toBe(
      'organization',
    )
    expect(scopeForPermission(ctx({ role: 'PropertyManager' }), 'property.read')).toBe(
      'assigned-properties',
    )
    expect(scopeForPermission(ctx({ role: 'Staff' }), 'property.read')).toBe(
      'assigned-properties',
    )
  })

  it('uses the scopeByPermission map when present; a missing permission resolves to none', () => {
    const map = new Map<Permission, DataScope>([['property.read', 'organization']])

    expect(scopeForPermission(ctx({ scopeByPermission: map }), 'property.read')).toBe(
      'organization',
    )
    expect(scopeForPermission(ctx({ scopeByPermission: map }), 'property.delete')).toBe(
      'none',
    )
  })
})
