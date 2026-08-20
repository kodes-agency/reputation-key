import { describe, expect, it } from 'vitest'
import type { DataScope } from './data-scope'
import { organizationId, userId } from './ids'
import type { Permission } from './permissions'
import type { AuthContext } from './auth-context'
import {
  googleAuthorizationPermissionDigest,
  sameGoogleContentAuthorizationVector,
} from './google-content-authorization-vector'

const actor = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  userId: userId('user-1'),
  organizationId: organizationId('organization-1'),
  role: 'AccountAdmin',
  ...overrides,
})

describe('googleAuthorizationPermissionDigest', () => {
  it('is stable across permission and scope insertion order', () => {
    const left = actor({
      effectivePermissions: new Set<Permission>(['property.read', 'property.update']),
      scopeByPermission: new Map<Permission, DataScope>([
        ['property.read', 'organization'],
        ['property.update', 'assigned-properties'],
      ]),
    })
    const right = actor({
      effectivePermissions: new Set<Permission>(['property.update', 'property.read']),
      scopeByPermission: new Map<Permission, DataScope>([
        ['property.update', 'assigned-properties'],
        ['property.read', 'organization'],
      ]),
    })

    expect(googleAuthorizationPermissionDigest(left)).toBe(
      googleAuthorizationPermissionDigest(right),
    )
  })

  it('treats omitted permission collections as empty', () => {
    expect(googleAuthorizationPermissionDigest(actor())).toBe(
      googleAuthorizationPermissionDigest(
        actor({ effectivePermissions: new Set(), scopeByPermission: new Map() }),
      ),
    )
  })
})

describe('sameGoogleContentAuthorizationVector', () => {
  it('compares equal vectors independently of key insertion order', () => {
    expect(
      sameGoogleContentAuthorizationVector(
        { organizationId: 'organization-1', sourceEpoch: 3, enabled: true },
        { enabled: true, sourceEpoch: 3, organizationId: 'organization-1' },
      ),
    ).toBe(true)
  })

  it.each([
    [{ sourceEpoch: 3 }, { sourceEpoch: 4 }],
    [{ sourceEpoch: 3 }, { sourceEpoch: 3, enabled: true }],
    [{ organizationId: 'organization-1' }, { propertyId: 'organization-1' }],
  ])('rejects vectors with different keys or values', (left, right) => {
    expect(sameGoogleContentAuthorizationVector(left, right)).toBe(false)
  })
})
