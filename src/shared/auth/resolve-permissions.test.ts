// resolve-permissions tests — the per-permission scope model + fail-closed custom
// roles. The headline case: a mixed-role user with dashboard.read@organization +
// portal.read@assigned-properties must NOT get org-wide portal visibility.

import { describe, it, expect } from 'vitest'
import type { Permission } from '#/shared/domain/permissions'
import { VALID_PERMISSIONS } from './permission-catalogue'
import { resolvePermissions } from './resolve-permissions'

// Test built-in provider: owner = everything, admin/member = representative subsets.
const builtInFor = (role: string): ReadonlySet<Permission> => {
  if (role === 'owner') return new Set(VALID_PERMISSIONS)
  if (role === 'admin')
    return new Set(['property.read', 'property.update', 'portal.read'] as Permission[])
  if (role === 'member') return new Set(['portal.read'] as Permission[])
  return new Set()
}

describe('resolvePermissions — built-in roles', () => {
  it('owner grants every permission at organization scope', () => {
    const r = resolvePermissions({
      roleNames: ['owner'],
      customRoles: [],
      policies: [],
      builtInPermissions: builtInFor,
    })
    expect(r.effectivePermissions.size).toBe(VALID_PERMISSIONS.length)
    for (const p of VALID_PERMISSIONS) {
      expect(r.scopeByPermission.get(p)).toBe('organization')
    }
  })

  it('admin grants its subset at assigned-properties scope', () => {
    const r = resolvePermissions({
      roleNames: ['admin'],
      customRoles: [],
      policies: [],
      builtInPermissions: builtInFor,
    })
    expect(r.effectivePermissions.has('property.update')).toBe(true)
    expect(r.scopeByPermission.get('property.read')).toBe('assigned-properties')
  })
})

describe('resolvePermissions — custom roles', () => {
  it('grants a custom role permissions at its policy scope', () => {
    const r = resolvePermissions({
      roleNames: ['content-manager'],
      customRoles: [
        { role: 'content-manager', permissions: ['portal.read', 'portal.update'] },
      ],
      policies: [{ role: 'content-manager', dataScope: 'assigned-properties' }],
      builtInPermissions: builtInFor,
    })
    expect([...r.effectivePermissions].sort()).toEqual(['portal.read', 'portal.update'])
    expect(r.scopeByPermission.get('portal.read')).toBe('assigned-properties')
    expect(r.scopeByPermission.get('portal.update')).toBe('assigned-properties')
  })

  it('skips (fail-closed) a custom role missing its policy', () => {
    const r = resolvePermissions({
      roleNames: ['orphan-role'],
      customRoles: [{ role: 'orphan-role', permissions: ['portal.read'] }],
      policies: [],
      builtInPermissions: builtInFor,
    })
    expect(r.effectivePermissions.size).toBe(0)
  })

  it('skips (fail-closed) a custom role missing its definition', () => {
    const r = resolvePermissions({
      roleNames: ['no-def'],
      customRoles: [],
      policies: [{ role: 'no-def', dataScope: 'organization' }],
      builtInPermissions: builtInFor,
    })
    expect(r.effectivePermissions.size).toBe(0)
  })
})

describe('resolvePermissions — no cross-permission widening (headline invariant)', () => {
  it('dashboard.read@organization does NOT widen portal.read@assigned-properties', () => {
    const r = resolvePermissions({
      roleNames: ['reporting-manager', 'content-manager'],
      customRoles: [
        { role: 'reporting-manager', permissions: ['dashboard.read'] },
        { role: 'content-manager', permissions: ['portal.read', 'portal.update'] },
      ],
      policies: [
        { role: 'reporting-manager', dataScope: 'organization' },
        { role: 'content-manager', dataScope: 'assigned-properties' },
      ],
      builtInPermissions: builtInFor,
    })
    expect(r.scopeByPermission.get('dashboard.read')).toBe('organization')
    // The crux: portal scope stays assigned-properties despite analytics@org.
    expect(r.scopeByPermission.get('portal.read')).toBe('assigned-properties')
    expect(r.scopeByPermission.get('portal.update')).toBe('assigned-properties')
  })
})

describe('resolvePermissions — scope aggregation', () => {
  it('takes the broadest scope when two roles grant the same permission', () => {
    const r = resolvePermissions({
      roleNames: ['a-role', 'b-role'],
      customRoles: [
        { role: 'a-role', permissions: ['portal.read'] },
        { role: 'b-role', permissions: ['portal.read'] },
      ],
      policies: [
        { role: 'a-role', dataScope: 'assigned-properties' },
        { role: 'b-role', dataScope: 'organization' },
      ],
      builtInPermissions: builtInFor,
    })
    expect(r.scopeByPermission.get('portal.read')).toBe('organization')
  })

  it('returns empty for empty roleNames', () => {
    const r = resolvePermissions({
      roleNames: [],
      customRoles: [],
      policies: [],
      builtInPermissions: builtInFor,
    })
    expect(r.effectivePermissions.size).toBe(0)
    expect(r.scopeByPermission.size).toBe(0)
  })

  it('canonicalizes role names (trim + lower-case) and ignores blanks', () => {
    const r = resolvePermissions({
      roleNames: ['  Owner  ', '', 'ADMIN'],
      customRoles: [],
      policies: [],
      builtInPermissions: builtInFor,
    })
    // owner + admin merged; blanks skipped.
    expect(r.scopeByPermission.get('property.update')).toBe('organization') // from owner
    expect(r.scopeByPermission.get('portal.read')).toBe('organization') // owner grants at org
  })
})
