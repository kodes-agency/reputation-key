// Integration context — google connection repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect } from 'vitest'
import { createGoogleConnectionRepository } from './google-connection.repository'
import { getDb } from '#/shared/db'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { organizationId, userId, googleConnectionId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'

const ORG_A = organizationId('org-gc-aaaaaaaaaa')
const ORG_B = organizationId('org-gc-bbbbbbbbbb')
const REPOSITORY_NOW = new Date('2026-04-10T12:34:56.789Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['google_connections'],
})

const makeRepo = () => createGoogleConnectionRepository(getDb(), () => REPOSITORY_NOW)

describe('googleConnectionRepository (integration)', () => {
  describe('insert and findById', () => {
    it('inserts and retrieves a connection', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: `signed-${crypto.randomUUID()}`,
      })

      await repo.insert(conn)
      const found = await repo.findById(ORG_A, conn.id)

      expect(found).not.toBeNull()
      expect(found!.googleSubject).toBe(conn.googleSubject)
      expect(found!.status).toBe('active')
      expect(found!.organizationId).toBe(ORG_A)
    })

    it('returns null for non-existent id', async () => {
      const repo = makeRepo()
      const fakeId = googleConnectionId(crypto.randomUUID())
      const found = await repo.findById(ORG_A, fakeId)
      expect(found).toBeNull()
    })
  })

  describe('findByGoogleIdentity', () => {
    it('finds a connection by signed OIDC subject within a tenant', async () => {
      const repo = makeRepo()
      const subject = `signed-${crypto.randomUUID()}`
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: subject,
      })
      await repo.insert(conn)

      const found = await repo.findByGoogleIdentity(ORG_A, {
        googleSubject: subject,
      })
      expect(found).toMatchObject({ id: conn.id })
    })

    it('finds a connection globally by signed OIDC subject', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: 'signed-subject-repo-test',
      })
      await repo.insert(conn)
      await expect(
        repo.findByGoogleIdentityGlobal({
          googleSubject: 'signed-subject-repo-test',
        }),
      ).resolves.toMatchObject({ id: conn.id })
    })
  })

  describe('listByOrganization', () => {
    it('lists all connections when showAll filter is passed', async () => {
      const repo = makeRepo()
      await repo.insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          googleSubject: `signed-${crypto.randomUUID()}`,
        }),
      )
      await repo.insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          googleSubject: `signed-${crypto.randomUUID()}`,
        }),
      )

      const results = await repo.listByOrganization(ORG_A, { showAll: true })
      expect(results).toHaveLength(2)
    })

    it('treats the legacy visibility filter as compatibility-only', async () => {
      const repo = makeRepo()
      const otherUser = userId('user-other')

      await repo.insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          googleSubject: `signed-${crypto.randomUUID()}`,
          visibility: 'organization',
          connectedBy: userId('user-someone-else'),
        }),
      )
      await repo.insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          googleSubject: `signed-${crypto.randomUUID()}`,
          visibility: 'organization',
          connectedBy: otherUser,
        }),
      )

      const results = await repo.listByOrganization(ORG_A, {
        showAll: false,
        userId: otherUser,
      })
      expect(results).toHaveLength(2)
    })
  })

  describe('listOrganizationIdsWithActiveConnections', () => {
    const insert = (
      org: typeof ORG_A,
      status: 'active' | 'degraded' | 'reauth_required',
    ) =>
      makeRepo().insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: org,
          googleSubject: `signed-${crypto.randomUUID()}`,
          status,
        }),
      )

    it('names each organization with an active connection once', async () => {
      await insert(ORG_A, 'active')
      await insert(ORG_A, 'active')
      await insert(ORG_B, 'active')

      const organizations = await makeRepo().listOrganizationIdsWithActiveConnections()

      expect(organizations.filter((id) => id === ORG_A || id === ORG_B).sort()).toEqual([
        ORG_A,
        ORG_B,
      ])
      expect(new Set(organizations).size).toBe(organizations.length)
    })

    it('leaves out an organization whose connections cannot call Google', async () => {
      await insert(ORG_B, 'degraded')
      await insert(ORG_B, 'reauth_required')

      const organizations = await makeRepo().listOrganizationIdsWithActiveConnections()

      expect(organizations).not.toContain(ORG_B)
    })
  })

  describe('tenant isolation', () => {
    it('findById does not return connections from other orgs', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: `signed-${crypto.randomUUID()}`,
      })
      await repo.insert(conn)

      const found = await repo.findById(ORG_B, conn.id)
      expect(found).toBeNull()
    })
  })

  describe('updateStatus', () => {
    it('updates the status of a connection', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: `signed-${crypto.randomUUID()}`,
        status: 'active',
      })
      await repo.insert(conn)

      await repo.updateStatus(ORG_A, conn.id, 'disconnected')
      const found = await repo.findById(ORG_A, conn.id)
      expect(found!.status).toBe('disconnected')
      const persisted = await getPool().query(
        'SELECT updated_at FROM google_connections WHERE organization_id = $1 AND id = $2',
        [ORG_A, conn.id],
      )
      expect(persisted.rows).toEqual([{ updated_at: REPOSITORY_NOW }])
    })
  })

  describe('updateVisibility', () => {
    it('rejects the legacy private visibility without changing Organization ownership', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: `signed-${crypto.randomUUID()}`,
        visibility: 'organization',
      })
      await repo.insert(conn)

      await expect(
        repo.updateVisibility(ORG_A, conn.id, 'private'),
      ).rejects.toMatchObject({
        cause: {
          code: '23514',
          constraint: 'google_connections_organization_owned_check',
        },
      })
      const found = await repo.findById(ORG_A, conn.id)
      expect(found!.visibility).toBe('organization')
    })
  })

  describe('updateTokens credential predicates', () => {
    const EXPECTED = { lifecycleVersion: 1, credentialGeneration: 1 }
    const NEW_EXPIRY = new Date('2027-01-01T00:00:00.000Z')

    const seed = async () => {
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: `signed-${crypto.randomUUID()}`,
      })
      await makeRepo().insert(conn)
      return conn
    }

    const credentialRow = async (id: string, orgId: string = ORG_A) => {
      const result = await getPool().query(
        `SELECT encrypted_access_token, encrypted_refresh_token, token_expires_at,
                credential_generation, lifecycle_version
           FROM google_connections WHERE organization_id = $1 AND id = $2`,
        [orgId, id],
      )
      return result.rows[0]
    }

    const rotate = (
      orgId: typeof ORG_A,
      id: string,
      expected: Readonly<{ lifecycleVersion: number; credentialGeneration: number }>,
    ) =>
      makeRepo().updateTokens(
        orgId,
        googleConnectionId(id),
        expected,
        'enc:rotated-access',
        'enc:rotated-refresh',
        NEW_EXPIRY,
      )

    it('replaces the secrets and advances the generation when every predicate holds', async () => {
      const conn = await seed()

      await expect(rotate(ORG_A, conn.id, EXPECTED)).resolves.toBe(true)

      await expect(credentialRow(conn.id)).resolves.toMatchObject({
        encrypted_access_token: 'enc:rotated-access',
        encrypted_refresh_token: 'enc:rotated-refresh',
        token_expires_at: NEW_EXPIRY,
        credential_generation: 2,
        lifecycle_version: 1,
      })
    })

    it('leaves the credential untouched for a stale credential generation', async () => {
      const conn = await seed()

      await expect(
        rotate(ORG_A, conn.id, { ...EXPECTED, credentialGeneration: 2 }),
      ).resolves.toBe(false)

      await expect(credentialRow(conn.id)).resolves.toMatchObject({
        encrypted_access_token: conn.encryptedAccessToken,
        credential_generation: 1,
      })
    })

    it('leaves the credential untouched for a stale lifecycle version', async () => {
      const conn = await seed()
      await makeRepo().updateStatus(ORG_A, conn.id, 'degraded')

      await expect(rotate(ORG_A, conn.id, EXPECTED)).resolves.toBe(false)

      await expect(credentialRow(conn.id)).resolves.toMatchObject({
        encrypted_access_token: conn.encryptedAccessToken,
        credential_generation: 1,
        lifecycle_version: 2,
      })
    })

    it.each(['cleanup_only', 'none'] as const)(
      'refuses a credential whose use state is %s',
      async (useState) => {
        const conn = await seed()
        await getPool().query(
          `UPDATE google_connections SET credential_use_state = $3
            WHERE organization_id = $1 AND id = $2`,
          [ORG_A, conn.id, useState],
        )

        await expect(rotate(ORG_A, conn.id, EXPECTED)).resolves.toBe(false)

        await expect(credentialRow(conn.id)).resolves.toMatchObject({
          encrypted_access_token: conn.encryptedAccessToken,
          credential_generation: 1,
        })
      },
    )

    it('does not touch another Organization’s connection, nor an unknown id', async () => {
      const conn = await seed()

      await expect(rotate(ORG_B, conn.id, EXPECTED)).resolves.toBe(false)
      await expect(rotate(ORG_A, crypto.randomUUID(), EXPECTED)).resolves.toBe(false)

      await expect(credentialRow(conn.id)).resolves.toMatchObject({
        encrypted_access_token: conn.encryptedAccessToken,
        credential_generation: 1,
      })
    })

    it('lets only one of two writers holding the same generation win', async () => {
      const conn = await seed()

      const results = await Promise.all([
        rotate(ORG_A, conn.id, EXPECTED),
        rotate(ORG_A, conn.id, EXPECTED),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      await expect(credentialRow(conn.id)).resolves.toMatchObject({
        credential_generation: 2,
      })
    })
  })

  // A connection row is never hard-deleted: disconnect redacts it in place
  // (`redactForDisconnect`) and each Property's reference moves with its
  // binding state through Property's `googleBinding` capability. The delete
  // that nulled those references without the binding store had no caller.
  describe('no hard delete', () => {
    it('offers no delete, so an inserted connection stays readable', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: `signed-${crypto.randomUUID()}`,
      })
      await repo.insert(conn)

      expect(Object.keys(repo)).not.toContain('delete')
      await expect(repo.findById(ORG_A, conn.id)).resolves.toMatchObject({
        id: conn.id,
        organizationId: ORG_A,
        status: 'active',
      })
    })
  })
})
