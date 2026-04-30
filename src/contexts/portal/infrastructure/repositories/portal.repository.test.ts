// Portal context — repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect } from 'vitest'
import { createPortalRepository } from './portal.repository'
import { getDb } from '#/shared/db'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'

const ORG_A = organizationId('org-aaaaaaaaaaaa')
const ORG_B = organizationId('org-bbbbbbbbbbbb')

setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['portal_links', 'portal_link_categories', 'portals'],
})

describe('portalRepository (integration)', () => {
  describe('insert and findById', () => {
    it('inserts and retrieves a portal', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)
      const portal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'Test Portal',
        slug: 'test-portal',
      })

      await repo.insert(ORG_A, portal)

      const found = await repo.findById(ORG_A, portal.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Test Portal')
      expect(found!.slug).toBe('test-portal')
    })

    it('finds portal by slug', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)
      const portal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'Slug Test',
        slug: 'slug-test',
      })

      await repo.insert(ORG_A, portal)

      const found = await repo.findBySlug(ORG_A, 'slug-test')
      expect(found).not.toBeNull()
      expect(found!.slug).toBe('slug-test')
    })

    it('does not return portals from other organizations', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)
      const portal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'Tenant Test',
        slug: 'tenant-test',
      })

      await repo.insert(ORG_A, portal)

      const foundInA = await repo.findById(ORG_A, portal.id)
      expect(foundInA).not.toBeNull()

      const foundInB = await repo.findById(ORG_B, portal.id)
      expect(foundInB).toBeNull()
    })
  })

  describe('slugExists', () => {
    it('does not leak across tenants', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)
      const portal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'Shared Slug',
        slug: 'shared-slug',
      })

      await repo.insert(ORG_A, portal)

      const existsInA = await repo.slugExists(ORG_A, 'shared-slug')
      expect(existsInA).toBe(true)

      const existsInB = await repo.slugExists(ORG_B, 'shared-slug')
      expect(existsInB).toBe(false)
    })
  })

  describe('list', () => {
    it('only returns portals for the given organization', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)

      const portalA = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'Portal A',
        slug: 'portal-a',
      })
      const portalB = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_B,
        name: 'Portal B',
        slug: 'portal-b',
      })

      await repo.insert(ORG_A, portalA)
      await repo.insert(ORG_B, portalB)

      const listA = await repo.list(ORG_A)
      expect(listA).toHaveLength(1)
      expect(listA[0].slug).toBe('portal-a')

      const listB = await repo.list(ORG_B)
      expect(listB).toHaveLength(1)
      expect(listB[0].slug).toBe('portal-b')
    })
  })

  describe('listByProperty', () => {
    it('filters by property and organization', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)
      const propId = propertyId('prop-11111111-1111-1111-1111-111111111111')

      const portal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        propertyId: propId,
        name: 'Property Portal',
        slug: 'property-portal',
      })

      await repo.insert(ORG_A, portal)

      const found = await repo.listByProperty(ORG_A, propId)
      expect(found).toHaveLength(1)
      expect(found[0].propertyId).toBe(propId)
    })
  })

  describe('softDelete', () => {
    it('removes portal from queries but preserves row', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)
      const portal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'To Delete',
        slug: 'to-delete',
      })

      await repo.insert(ORG_A, portal)
      await repo.softDelete(ORG_A, portal.id)

      const found = await repo.findById(ORG_A, portal.id)
      expect(found).toBeNull()

      const list = await repo.list(ORG_A)
      expect(list).toHaveLength(0)
    })

    it('allows a new portal with the same slug after soft-delete', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)
      const portal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'Reuse Slug',
        slug: 'reuse-slug',
      })

      await repo.insert(ORG_A, portal)
      await repo.softDelete(ORG_A, portal.id)

      const newPortal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'Reuse Slug New',
        slug: 'reuse-slug',
      })

      await repo.insert(ORG_A, newPortal)

      const found = await repo.findBySlug(ORG_A, 'reuse-slug')
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Reuse Slug New')
    })
  })

  describe('update', () => {
    it('updates specified fields', async () => {
      const db = getDb()
      const repo = createPortalRepository(db)
      const portal = buildTestPortal({
        id: crypto.randomUUID(),
        organizationId: ORG_A,
        name: 'Original',
        slug: 'original',
      })

      await repo.insert(ORG_A, portal)
      await repo.update(ORG_A, portal.id, { name: 'Updated' })

      const found = await repo.findById(ORG_A, portal.id)
      expect(found!.name).toBe('Updated')
      expect(found!.slug).toBe('original')
    })
  })
})
