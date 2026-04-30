// Portal context — portal link repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createPortalLinkRepository } from './portal-link.repository'
import { createPortalRepository } from './portal.repository'
import { getDb } from '#/shared/db'
import {
  buildTestPortal,
  buildTestPortalLinkCategory,
  buildTestPortalLink,
} from '#/shared/testing/fixtures'
import { organizationId, portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = organizationId('org-cccccccccccc')
const ORG_B = organizationId('org-dddddddddddd')

let pool: Pool

async function truncateAll(pool: Pool) {
  await pool.query('DELETE FROM portal_links WHERE organization_id IN ($1, $2)', [ORG_A, ORG_B])
  await pool.query('DELETE FROM portal_link_categories WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id IN ($1, $2)', [ORG_A, ORG_B])
}

async function seedOrg(pool: Pool, ids: string[]) {
  for (const id of ids) {
    const slug = 't-' + id.replace(/-/g, '').slice(-12)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, `Test Org ${slug}`, slug],
    )
  }
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
  await seedOrg(pool, [ORG_A, ORG_B])
})

describe('portalLinkRepository (integration)', () => {
  async function seedPortal(orgId: typeof ORG_A, slug: string, overrides = {}) {
    const portalRepo = createPortalRepository(getDb())
    const portal = buildTestPortal({ id: crypto.randomUUID(), organizationId: orgId, slug, ...overrides })
    await portalRepo.insert(orgId, portal)
    return portal
  }

  describe('categories', () => {
    it('inserts and lists categories for a portal', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'cat-test')

      const cat = buildTestPortalLinkCategory({
        id: portalLinkCategoryId(crypto.randomUUID()),
        portalId: portal.id,
        organizationId: ORG_A,
        title: 'Category A',
        sortKey: 'a0',
      })
      await repo.insertCategory(ORG_A, cat)

      const categories = await repo.listCategories(ORG_A, portal.id)
      expect(categories).toHaveLength(1)
      expect(categories[0].title).toBe('Category A')
    })

    it('tenant-isolates category list', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portalA = await seedPortal(ORG_A, 'cat-tenant-a')
      const portalB = await seedPortal(ORG_B, 'cat-tenant-b')

      const catA = buildTestPortalLinkCategory({
        id: portalLinkCategoryId(crypto.randomUUID()),
        portalId: portalA.id,
        organizationId: ORG_A,
        title: 'Org A Cat',
        sortKey: 'a0',
      })
      const catB = buildTestPortalLinkCategory({
        id: portalLinkCategoryId(crypto.randomUUID()),
        portalId: portalB.id,
        organizationId: ORG_B,
        title: 'Org B Cat',
        sortKey: 'a0',
      })
      await repo.insertCategory(ORG_A, catA)
      await repo.insertCategory(ORG_B, catB)

      const orgACats = await repo.listCategories(ORG_A, portalA.id)
      expect(orgACats).toHaveLength(1)
      expect(orgACats[0].title).toBe('Org A Cat')

      const orgBCats = await repo.listCategories(ORG_B, portalB.id)
      expect(orgBCats).toHaveLength(1)
      expect(orgBCats[0].title).toBe('Org B Cat')
    })

    it('updates a category title', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'cat-update')

      const cat = buildTestPortalLinkCategory({
        id: portalLinkCategoryId(crypto.randomUUID()),
        portalId: portal.id,
        organizationId: ORG_A,
        title: 'Old Title',
        sortKey: 'a0',
      })
      await repo.insertCategory(ORG_A, cat)
      await repo.updateCategory(ORG_A, cat.id, { title: 'New Title' })

      const found = await repo.findCategoryById(ORG_A, cat.id)
      expect(found?.title).toBe('New Title')
    })

    it('deletes a category', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'cat-delete')

      const cat = buildTestPortalLinkCategory({
        id: portalLinkCategoryId(crypto.randomUUID()),
        portalId: portal.id,
        organizationId: ORG_A,
        title: 'To Delete',
        sortKey: 'a0',
      })
      await repo.insertCategory(ORG_A, cat)
      await repo.deleteCategory(ORG_A, cat.id)

      const found = await repo.findCategoryById(ORG_A, cat.id)
      expect(found).toBeNull()
    })

    it('reorders categories', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'cat-reorder')

      const cat1 = buildTestPortalLinkCategory({
        id: portalLinkCategoryId(crypto.randomUUID()),
        portalId: portal.id,
        organizationId: ORG_A,
        title: 'Cat 1',
        sortKey: 'a0',
      })
      const cat2 = buildTestPortalLinkCategory({
        id: portalLinkCategoryId(crypto.randomUUID()),
        portalId: portal.id,
        organizationId: ORG_A,
        title: 'Cat 2',
        sortKey: 'a1',
      })
      await repo.insertCategory(ORG_A, cat1)
      await repo.insertCategory(ORG_A, cat2)

      await repo.reorderCategories(ORG_A, [
        { id: cat1.id, sortKey: 'b0' },
        { id: cat2.id, sortKey: 'a0' },
      ])

      const categories = await repo.listCategories(ORG_A, portal.id)
      expect(categories[0].sortKey).toBe('a0')
      expect(categories[1].sortKey).toBe('b0')
    })
  })

  describe('links', () => {
    async function seedCategory(orgId: typeof ORG_A, portal: ReturnType<typeof buildTestPortal>, title: string) {
      const repo = createPortalLinkRepository(getDb())
      const cat = buildTestPortalLinkCategory({
        id: portalLinkCategoryId(crypto.randomUUID()),
        portalId: portal.id,
        organizationId: orgId,
        title,
        sortKey: 'a0',
      })
      await repo.insertCategory(orgId, cat)
      return cat
    }

    it('inserts and lists links for a category', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'link-test')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        label: 'Booking',
        url: 'https://book.example.com',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, link)

      const links = await repo.listLinks(ORG_A, cat.id)
      expect(links).toHaveLength(1)
      expect(links[0].label).toBe('Booking')
    })

    it('tenant-isolates link list', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portalA = await seedPortal(ORG_A, 'link-tenant-a')
      const portalB = await seedPortal(ORG_B, 'link-tenant-b')
      const catA = await seedCategory(ORG_A, portalA, 'Cat A')
      const catB = await seedCategory(ORG_B, portalB, 'Cat B')

      const linkA = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: catA.id,
        portalId: portalA.id,
        organizationId: ORG_A,
        label: 'Link A',
        sortKey: 'a0',
      })
      const linkB = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: catB.id,
        portalId: portalB.id,
        organizationId: ORG_B,
        label: 'Link B',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, linkA)
      await repo.insertLink(ORG_B, linkB)

      const orgALinks = await repo.listLinks(ORG_A, catA.id)
      expect(orgALinks).toHaveLength(1)
      expect(orgALinks[0].label).toBe('Link A')
    })

    it('updates a link', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'link-update')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        label: 'Old Label',
        url: 'https://old.example.com',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, link)
      await repo.updateLink(ORG_A, link.id, { label: 'New Label', url: 'https://new.example.com' })

      const found = await repo.findLinkById(ORG_A, link.id)
      expect(found?.label).toBe('New Label')
      expect(found?.url).toBe('https://new.example.com')
    })

    it('deletes a link', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'link-delete')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        label: 'To Delete',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, link)
      await repo.deleteLink(ORG_A, link.id)

      const found = await repo.findLinkById(ORG_A, link.id)
      expect(found).toBeNull()
    })

    it('reorders links', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'link-reorder')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link1 = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        label: 'Link 1',
        sortKey: 'a0',
      })
      const link2 = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        label: 'Link 2',
        sortKey: 'a1',
      })
      await repo.insertLink(ORG_A, link1)
      await repo.insertLink(ORG_A, link2)

      await repo.reorderLinks(ORG_A, [
        { id: link1.id, sortKey: 'b0' },
        { id: link2.id, sortKey: 'a0' },
      ])

      const links = await repo.listLinks(ORG_A, cat.id)
      expect(links[0].sortKey).toBe('a0')
      expect(links[1].sortKey).toBe('b0')
    })

    it('lists all links for a portal', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db)
      const portal = await seedPortal(ORG_A, 'link-all')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        label: 'All Links Test',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, link)

      const allLinks = await repo.listAllLinks(ORG_A, portal.id)
      expect(allLinks).toHaveLength(1)
      expect(allLinks[0].label).toBe('All Links Test')
    })
  })
})
