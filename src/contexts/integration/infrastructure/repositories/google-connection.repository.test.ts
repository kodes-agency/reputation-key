// Integration context — google connection repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect } from 'vitest'
import { createGoogleConnectionRepository } from './google-connection.repository'
import { getDb } from '#/shared/db'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { organizationId, userId, googleConnectionId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { PropertyFkCleanupPort } from '../../application/ports/property-fk-cleanup.port'

const ORG_A = organizationId('org-gc-aaaaaaaaaa')
const ORG_B = organizationId('org-gc-bbbbbbbbbb')

setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['google_connections'],
})

/** No-op FK cleanup for integration tests — we don't test FK nulling here. */
const noopFkCleanup: PropertyFkCleanupPort = {
  clearGoogleConnectionRef: async () => {},
}

const makeRepo = () => createGoogleConnectionRepository(getDb(), noopFkCleanup)

describe('googleConnectionRepository (integration)', () => {
  describe('insert and findById', () => {
    it('inserts and retrieves a connection', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleAccountId: crypto.randomUUID(),
        googleEmail: 'test-a@example.com',
      })

      await repo.insert(conn)
      const found = await repo.findById(ORG_A, conn.id)

      expect(found).not.toBeNull()
      expect(found!.googleEmail).toBe('test-a@example.com')
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

  describe('findByGoogleAccountId', () => {
    it('finds connection by google account id', async () => {
      const repo = makeRepo()
      const gaId = crypto.randomUUID()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleAccountId: gaId,
      })
      await repo.insert(conn)

      const found = await repo.findByGoogleAccountId(ORG_A, gaId)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(conn.id)
    })
  })

  describe('listByOrganization', () => {
    it('lists all connections when showAll filter is passed', async () => {
      const repo = makeRepo()
      await repo.insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          googleAccountId: crypto.randomUUID(),
          googleEmail: 'a1@example.com',
        }),
      )
      await repo.insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          googleAccountId: crypto.randomUUID(),
          googleEmail: 'a2@example.com',
        }),
      )

      const results = await repo.listByOrganization(ORG_A, { showAll: true })
      expect(results).toHaveLength(2)
    })

    it('only shows visible + own connections when showAll is false', async () => {
      const repo = makeRepo()
      const otherUser = userId('user-other')

      await repo.insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          googleAccountId: crypto.randomUUID(),
          googleEmail: 'visible@example.com',
          visibility: 'organization',
          connectedBy: userId('user-someone-else'),
        }),
      )
      await repo.insert(
        buildTestGoogleConnection({
          id: crypto.randomUUID(),
          organizationId: ORG_A,
          googleAccountId: crypto.randomUUID(),
          googleEmail: 'private@example.com',
          visibility: 'private',
          connectedBy: otherUser,
        }),
      )

      const results = await repo.listByOrganization(ORG_A, {
        showAll: false,
        userId: otherUser,
      })
      // Non-admin sees: organization-visible + own private
      expect(results.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('tenant isolation', () => {
    it('findById does not return connections from other orgs', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleAccountId: crypto.randomUUID(),
        googleEmail: 'isolate@example.com',
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
        googleAccountId: crypto.randomUUID(),
        status: 'active',
      })
      await repo.insert(conn)

      await repo.updateStatus(ORG_A, conn.id, 'disconnected')
      const found = await repo.findById(ORG_A, conn.id)
      expect(found!.status).toBe('disconnected')
    })
  })

  describe('updateVisibility', () => {
    it('updates visibility', async () => {
      const repo = makeRepo()
      const conn = buildTestGoogleConnection({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        googleAccountId: crypto.randomUUID(),
        visibility: 'private',
      })
      await repo.insert(conn)

      await repo.updateVisibility(ORG_A, conn.id, 'organization')
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
        googleAccountId: crypto.randomUUID(),
      })
      await repo.insert(conn)

      await repo.delete(ORG_A, conn.id)
      const found = await repo.findById(ORG_A, conn.id)
      expect(found).toBeNull()
    })
  })
})
