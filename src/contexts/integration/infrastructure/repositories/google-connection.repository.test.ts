// Integration context — google connection repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { beforeEach, describe, it, expect } from 'vitest'
import { createGoogleConnectionRepository } from './google-connection.repository'
import { getDb } from '#/shared/db'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { organizationId, userId, googleConnectionId } from '#/shared/domain/ids'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { PropertyFkCleanupPort } from '../../application/ports/property-fk-cleanup.port'

const ORG_A = organizationId('org-gc-aaaaaaaaaa')
const ORG_B = organizationId('org-gc-bbbbbbbbbb')
const REPOSITORY_NOW = new Date('2026-04-10T12:34:56.789Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['google_connections', 'google_organization_credential_homes'],
})

beforeEach(async () => {
  for (const organization of [ORG_A, ORG_B]) {
    await getPool().query(
      `INSERT INTO google_organization_credential_homes (
         organization_id, authority_generation, home_cell_id,
         catalogue_policy_version, transition_reason, changed_by,
         effective_from, created_at, updated_at
       ) VALUES ($1, 1, 'us', $2, 'new_grant', $3, $4, $4, $4)`,
      [
        organization,
        DATA_CELL_CATALOGUE_POLICY_VERSION,
        'user-google-connection-repository-test',
        new Date('2026-04-10T12:00:00.000Z'),
      ],
    )
  }
})

/** No-op FK cleanup for integration tests — we don't test FK nulling here. */
const noopFkCleanup: PropertyFkCleanupPort = {
  clearGoogleConnectionRef: async () => {},
}

const makeRepo = () =>
  createGoogleConnectionRepository(getDb(), noopFkCleanup, () => REPOSITORY_NOW)

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

  describe('delete', () => {
    it('deletes a connection', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleSubject: `signed-${crypto.randomUUID()}`,
      })
      await repo.insert(conn)

      await repo.delete(ORG_A, conn.id)
      const found = await repo.findById(ORG_A, conn.id)
      expect(found).toBeNull()
    })
  })
})
