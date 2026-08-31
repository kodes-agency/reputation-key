// In-memory GoogleConnectionRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type {
  GoogleConnectionRepository,
  ConnectionVisibilityFilter,
  GoogleConnectionIdentityLookup,
} from '#/contexts/integration/application/ports/google-connection.repository'
import type { GoogleConnection } from '#/contexts/integration/domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

export type InMemoryGoogleConnectionRepo = GoogleConnectionRepository &
  Readonly<{
    seed: (connections: ReadonlyArray<GoogleConnection>) => void
    all: () => ReadonlyArray<GoogleConnection>
  }>

export const createInMemoryGoogleConnectionRepo = (): InMemoryGoogleConnectionRepo => {
  const store = new Map<string, GoogleConnection>()

  const byOrg = (orgId: OrganizationId) => (c: GoogleConnection) =>
    c.organizationId === orgId
  const matchesIdentity = (
    connection: GoogleConnection,
    identity: GoogleConnectionIdentityLookup,
  ) => connection.googleSubject === identity.googleSubject
  return {
    findById: async (orgId, id) => {
      const connection = store.get(id as string)
      return connection && byOrg(orgId)(connection) ? connection : null
    },

    findByGoogleIdentity: async (orgId, identity) => {
      for (const connection of store.values()) {
        if (byOrg(orgId)(connection) && matchesIdentity(connection, identity)) {
          return connection
        }
      }
      return null
    },
    findByGoogleIdentityGlobal: async (identity) => {
      for (const connection of store.values()) {
        if (matchesIdentity(connection, identity)) {
          return connection
        }
      }
      return null
    },

    listByOrganization: async (orgId, _filter: ConnectionVisibilityFilter) => {
      const orgConnections = [...store.values()].filter(byOrg(orgId))
      return orgConnections
    },

    insert: async (connection) => {
      store.set(connection.id as string, connection)
    },

    updateStatus: async (orgId, id, status) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, {
        ...existing,
        status,
        lifecycleVersion: existing.lifecycleVersion + 1,
        updatedAt: new Date(),
      })
    },

    redactForDisconnect: async (orgId, id) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, {
        ...existing,
        encryptedAccessToken: 'redacted',
        encryptedRefreshToken: 'redacted',
        googleSubject: null,
        scopes: [],
        credentialUseState: 'none',
        cleanupMaterialDeadlineAt: null,
        lifecycleVersion: existing.lifecycleVersion + 1,
        accessVersion: existing.accessVersion + 1,
        credentialGeneration: existing.credentialGeneration + 1,
        updatedAt: new Date(),
      })
    },

    updateVisibility: async (orgId, id, visibility) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, {
        ...existing,
        visibility,
        accessVersion: existing.accessVersion + 1,
        updatedAt: new Date(),
      })
    },

    updateTokens: async (
      orgId,
      id,
      expected,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
    ) => {
      const existing = store.get(id as string)
      if (
        !existing ||
        !byOrg(orgId)(existing) ||
        existing.credentialUseState !== 'active' ||
        existing.lifecycleVersion !== expected.lifecycleVersion ||
        existing.credentialGeneration !== expected.credentialGeneration
      ) {
        return false
      }
      store.set(id as string, {
        ...existing,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        credentialGeneration: existing.credentialGeneration + 1,
        updatedAt: new Date(),
      })
      return true
    },

    updateTokensAndStatus: async (
      orgId,
      id,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      status,
    ) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, {
        ...existing,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        status,
        credentialGeneration: existing.credentialGeneration + 1,
        accessVersion: existing.accessVersion + 1,
        updatedAt: new Date(),
      })
    },

    updateReconnection: async (
      orgId,
      id,
      googleSubject,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      visibility,
      scopes,
      credentialHome,
      credentialAuthorizedBy,
      credentialAuthorizedAt,
    ) => {
      const existing = store.get(id as string)
      if (!existing || !byOrg(orgId)(existing)) return
      store.set(id as string, {
        ...existing,
        googleSubject,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        visibility,
        scopes: [...scopes],
        credentialAuthorizedBy,
        status: 'active',
        credentialUseState: 'active',
        credentialHomeCellId: credentialHome.homeCellId,
        credentialHomePolicyVersion: credentialHome.cataloguePolicyVersion,
        credentialHomeAuthorityGeneration: credentialHome.authorityGeneration,
        cleanupMaterialDeadlineAt: null,
        lifecycleVersion: existing.lifecycleVersion + 1,
        accessVersion: existing.accessVersion + 1,
        credentialGeneration: existing.credentialGeneration + 1,
        statusChangedAt: credentialAuthorizedAt,
        updatedAt: credentialAuthorizedAt,
      })
    },

    delete: async (orgId, id) => {
      const existing = store.get(id as string)
      if (existing && byOrg(orgId)(existing)) {
        store.delete(id as string)
      }
    },

    // ── Test-only helpers ───────────────────────────────────────────

    seed: (connections) => {
      for (const c of connections) store.set(c.id as string, c)
    },

    all: () => [...store.values()],
  }
}
