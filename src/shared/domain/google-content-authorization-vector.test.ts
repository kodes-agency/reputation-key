import { describe, expect, it } from 'vitest'
import type { DataScope } from './data-scope'
import { organizationId, userId } from './ids'
import type { Permission } from './permissions'
import type { AuthContext } from './auth-context'
import {
  googleAuthorizationPermissionDigest,
  sameFrozenGoogleContentAuthorizationVector,
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

describe('sameFrozenGoogleContentAuthorizationVector', () => {
  // The eight-key shape `authorizationFromRow` reconstitutes from
  // google_import_v2_items (google-import-v2-store.ts:181-190).
  const persisted = (
    overrides: Partial<Record<string, string | number | boolean | null>> = {},
  ) => ({
    executionPolicyVersion: 'beta-local-2',
    googleContentPolicyVersion: 11,
    emergencyKillVersion: 4,
    role: 'AccountAdmin',
    permissionDigest: 'a'.repeat(64),
    connectionLifecycleVersion: 3,
    connectionAccessVersion: 4,
    credentialGeneration: 5,
    ...overrides,
  })

  it('ignores a moved global policy cache generation', () => {
    expect(
      sameFrozenGoogleContentAuthorizationVector(
        persisted({ googleContentPolicyVersion: 11 }),
        persisted({ googleContentPolicyVersion: 12 }),
      ),
    ).toBe(true)
  })

  it.each([
    ['the emergency kill epoch', { emergencyKillVersion: 5 }],
    ['the execution policy version', { executionPolicyVersion: 'beta-local-3' }],
    ['the actor role', { role: 'Staff' }],
    ['the permission digest', { permissionDigest: 'b'.repeat(64) }],
    ['the connection lifecycle version', { connectionLifecycleVersion: 4 }],
    ['the connection access version', { connectionAccessVersion: 5 }],
    ['the credential generation', { credentialGeneration: 6 }],
  ])('still rejects a vector whose %s moved', (_label, drift) => {
    expect(
      sameFrozenGoogleContentAuthorizationVector(persisted(), persisted(drift)),
    ).toBe(false)
    // …and rejects it even when the cache generation moved in the same window,
    // so the exclusion cannot mask a real change that rode along with a bump.
    expect(
      sameFrozenGoogleContentAuthorizationVector(
        persisted(),
        persisted({ ...drift, googleContentPolicyVersion: 12 }),
      ),
    ).toBe(false)
  })

  it('still requires every other key to be present on both sides', () => {
    const { emergencyKillVersion: _dropped, ...missingKillEpoch } = persisted()
    expect(
      sameFrozenGoogleContentAuthorizationVector(persisted(), missingKillEpoch),
    ).toBe(false)
    expect(
      sameFrozenGoogleContentAuthorizationVector(missingKillEpoch, persisted()),
    ).toBe(false)
  })

  it('compares vectors that never carried the generation key at all', () => {
    const { googleContentPolicyVersion: _absent, ...withoutGeneration } = persisted()
    expect(
      sameFrozenGoogleContentAuthorizationVector(withoutGeneration, persisted()),
    ).toBe(true)
    expect(
      sameFrozenGoogleContentAuthorizationVector(
        withoutGeneration,
        persisted({ role: 'Staff' }),
      ),
    ).toBe(false)
  })
})
