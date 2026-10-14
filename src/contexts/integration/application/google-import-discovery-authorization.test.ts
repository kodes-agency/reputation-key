import { describe, expect, it } from 'vitest'
import { sameDiscoveryAuthorization } from './google-import-discovery-authorization'
import type { ImportDiscoveryAuthorization } from './ports/google-import-reference-store.port'

function authorizationAt(
  credentialGeneration: number,
  overrides: Partial<ImportDiscoveryAuthorization> = {},
): ImportDiscoveryAuthorization {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    connectionId: 'connection-1',
    connectionLifecycleVersion: 3,
    connectionAccessVersion: 4,
    credentialGeneration,
    authorizationVector: {
      role: 'Admin',
      permissionDigest: 'a'.repeat(64),
      credentialGeneration,
    },
    ...overrides,
  }
}

describe('sameDiscoveryAuthorization', () => {
  it('accepts an authorization that has not moved', () => {
    expect(sameDiscoveryAuthorization(authorizationAt(5), authorizationAt(5))).toBe(true)
  })

  it('accepts a credential generation that a routine token refresh advanced', () => {
    expect(sameDiscoveryAuthorization(authorizationAt(5), authorizationAt(6))).toBe(true)
  })

  it('refuses a credential generation that went backwards', () => {
    expect(sameDiscoveryAuthorization(authorizationAt(5), authorizationAt(4))).toBe(false)
  })

  it.each([
    ['organization', { organizationId: 'org-2' }],
    ['user', { userId: 'user-2' }],
    ['connection', { connectionId: 'connection-2' }],
    ['lifecycle version', { connectionLifecycleVersion: 4 }],
    ['access version', { connectionAccessVersion: 5 }],
  ] as const)(
    'refuses a changed %s even when the generation only advanced',
    (_, over) => {
      expect(
        sameDiscoveryAuthorization(authorizationAt(5), authorizationAt(6, over)),
      ).toBe(false)
    },
  )

  it('refuses a changed role or permission digest in the vector', () => {
    const changedRole = authorizationAt(6, {
      authorizationVector: {
        role: 'Member',
        permissionDigest: 'a'.repeat(64),
        credentialGeneration: 6,
      },
    })
    const changedDigest = authorizationAt(6, {
      authorizationVector: {
        role: 'Admin',
        permissionDigest: 'b'.repeat(64),
        credentialGeneration: 6,
      },
    })

    expect(sameDiscoveryAuthorization(authorizationAt(5), changedRole)).toBe(false)
    expect(sameDiscoveryAuthorization(authorizationAt(5), changedDigest)).toBe(false)
  })
})
