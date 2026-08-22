import { describe, expect, it } from 'vitest'
import type { DataScope } from './data-scope'
import { organizationId, userId } from './ids'
import type { Permission } from './permissions'
import type { AuthContext } from './auth-context'
import {
  FROZEN_VECTOR_EXCLUDED_KEYS,
  frozenVectorDrift,
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

  // CONTRACT CHANGE (was: "still rejects … the credential generation").
  // `updateTokens` bumps `credential_generation` — and only it — on a routine
  // expired-access-token refresh, so requiring equality here reported
  // revocation for a successful refresh and cancelled any import whose token
  // aged between approval and effect. Monotonicity did NOT move to nowhere: it
  // is enforced by `sameExpectedConnection` (`credentialGeneration >=`, a
  // regression still denies) against the live connection row, which is a
  // stronger check than comparing two copies of the same frozen number.
  it('ignores a credential generation moved by a routine token refresh', () => {
    expect(
      sameFrozenGoogleContentAuthorizationVector(
        persisted({ credentialGeneration: 5 }),
        persisted({ credentialGeneration: 6 }),
      ),
    ).toBe(true)
    // Both excluded counters moving at once — a sibling item's policy write and
    // a token refresh in the same window — is still not a revocation.
    expect(
      sameFrozenGoogleContentAuthorizationVector(
        persisted(),
        persisted({ credentialGeneration: 6, googleContentPolicyVersion: 12 }),
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

  // The deny log at the call site reports WHICH keys drifted. It must agree
  // with the comparison above by construction: a log that blamed an excluded
  // key would send the next investigation exactly where the last one already
  // went, which is the failure this instrumentation exists to prevent.
  describe('frozenVectorDrift', () => {
    it('reports only keys that can actually cause a denial', () => {
      expect(
        frozenVectorDrift(
          persisted(),
          persisted({
            googleContentPolicyVersion: 12,
            credentialGeneration: 6,
            role: 'Staff',
          }),
        ),
      ).toEqual([{ key: 'role', frozen: 'AccountAdmin', recomputed: 'Staff' }])
    })

    it('is empty exactly when the comparison passes', () => {
      const recomputed = persisted({
        googleContentPolicyVersion: 99,
        credentialGeneration: 7,
      })
      expect(sameFrozenGoogleContentAuthorizationVector(persisted(), recomputed)).toBe(
        true,
      )
      expect(frozenVectorDrift(persisted(), recomputed)).toEqual([])
    })

    it('skips exactly the keys the comparison excludes', () => {
      for (const key of FROZEN_VECTOR_EXCLUDED_KEYS) {
        expect(frozenVectorDrift(persisted(), persisted({ [key]: 12345 }))).toEqual([])
      }
    })
  })
})
