// Portal context — portal link repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createPortalLinkRepository } from './portal-link.repository'
import { getDb } from '#/shared/db'
import {
  buildTestPortal,
  buildTestPortalLinkCategory,
  buildTestPortalLink,
} from '#/shared/testing/fixtures'
import {
  organizationId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
} from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { createPostgresPortalFixtureStore } from '../testing/postgres-portal-fixture-store'

const ORG_A = organizationId('org-cccccccccccc')
const ORG_B = organizationId('org-dddddddddddd')
const PROPERTY_A = propertyId('ca000000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('cb000000-0000-4000-8000-000000000001')
const REPOSITORY_NOW = new Date('2026-08-28T00:00:00.000Z')

let pool: Pool

async function truncateAll(pool: Pool) {
  await pool.query('DELETE FROM portal_links WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query(
    'DELETE FROM portal_link_categories WHERE organization_id IN ($1, $2)',
    [ORG_A, ORG_B],
  )
  await pool.query('DELETE FROM portals WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
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

async function seedProperties(pool: Pool) {
  for (const [id, orgId, slug] of [
    [PROPERTY_A, ORG_A, 'portal-link-a'],
    [PROPERTY_B, ORG_B, 'portal-link-b'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, $3, $3, 'UTC')
       ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
      [id, orgId, slug],
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
  await seedProperties(pool)
})

describe('portalLinkRepository (integration)', () => {
  async function seedPortal(orgId: typeof ORG_A, slug: string, overrides = {}) {
    const portal = buildTestPortal({
      id: crypto.randomUUID(),
      organizationId: orgId,
      propertyId: orgId === ORG_A ? PROPERTY_A : PROPERTY_B,
      slug,
      ...overrides,
    })
    await createPostgresPortalFixtureStore(getDb()).insert(orgId, portal)
    return portal
  }

  describe('categories', () => {
    it('inserts and lists categories for a portal', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db, () => REPOSITORY_NOW)
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
      const repo = createPortalLinkRepository(db, () => REPOSITORY_NOW)
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
  })

  describe('links', () => {
    async function seedCategory(
      orgId: typeof ORG_A,
      portal: ReturnType<typeof buildTestPortal>,
      title: string,
    ) {
      const repo = createPortalLinkRepository(getDb(), () => REPOSITORY_NOW)
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
      const repo = createPortalLinkRepository(db, () => REPOSITORY_NOW)
      const portal = await seedPortal(ORG_A, 'link-test')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        propertyId: portal.propertyId,
        label: 'Booking',
        url: 'https://book.example.com',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, link)

      const links = await repo.listLinks(ORG_A, portal.id, cat.id)
      expect(links).toHaveLength(1)
      expect(links[0].label).toBe('Booking')
      await expect(repo.findLinkCommandTarget(ORG_A, link.id)).resolves.toEqual({
        link,
        portalUpdatedAt: portal.updatedAt,
      })
    })

    it('tenant-isolates link list', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db, () => REPOSITORY_NOW)
      const portalA = await seedPortal(ORG_A, 'link-tenant-a')
      const portalB = await seedPortal(ORG_B, 'link-tenant-b')
      const catA = await seedCategory(ORG_A, portalA, 'Cat A')
      const catB = await seedCategory(ORG_B, portalB, 'Cat B')

      const linkA = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: catA.id,
        portalId: portalA.id,
        organizationId: ORG_A,
        propertyId: portalA.propertyId,
        label: 'Link A',
        sortKey: 'a0',
      })
      const linkB = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: catB.id,
        portalId: portalB.id,
        organizationId: ORG_B,
        propertyId: portalB.propertyId,
        label: 'Link B',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, linkA)
      await repo.insertLink(ORG_B, linkB)

      const orgALinks = await repo.listLinks(ORG_A, portalA.id, catA.id)
      expect(orgALinks).toHaveLength(1)
      expect(orgALinks[0].label).toBe('Link A')
    })

    it('updates a link', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db, () => REPOSITORY_NOW)
      const portal = await seedPortal(ORG_A, 'link-update')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        propertyId: portal.propertyId,
        label: 'Old Label',
        url: 'https://old.example.com',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, link)
      await repo.updateLink(ORG_A, portal.id, link.id, {
        url: 'https://new.example.com',
      })

      const found = await repo.findLinkById(ORG_A, link.id)
      // The legacy label column is never written by an update.
      expect(found?.label).toBe('Old Label')
      expect(found?.url).toBe('https://new.example.com')
    })

    it('deletes a link', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db, () => REPOSITORY_NOW)
      const portal = await seedPortal(ORG_A, 'link-delete')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        propertyId: portal.propertyId,
        label: 'To Delete',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, link)
      await repo.deleteLink(ORG_A, portal.id, link.id)

      const found = await repo.findLinkById(ORG_A, link.id)
      expect(found).toBeNull()
    })

    it('reorders links', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db, () => REPOSITORY_NOW)
      const portal = await seedPortal(ORG_A, 'link-reorder')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link1 = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        propertyId: portal.propertyId,
        label: 'Link 1',
        sortKey: 'a0',
      })
      const link2 = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        propertyId: portal.propertyId,
        label: 'Link 2',
        sortKey: 'a1',
      })
      await repo.insertLink(ORG_A, link1)
      await repo.insertLink(ORG_A, link2)

      await repo.reorderLinks(ORG_A, portal.id, cat.id, [
        { id: link1.id, sortKey: 'b0' },
        { id: link2.id, sortKey: 'a0' },
      ])

      const links = await repo.listLinks(ORG_A, portal.id, cat.id)
      expect(links[0].sortKey).toBe('a0')
      expect(links[1].sortKey).toBe('b0')
      expect(links.map((link) => link.updatedAt)).toEqual([
        REPOSITORY_NOW,
        REPOSITORY_NOW,
      ])
    })

    it('lists all links for a portal', async () => {
      const db = getDb()
      const repo = createPortalLinkRepository(db, () => REPOSITORY_NOW)
      const portal = await seedPortal(ORG_A, 'link-all')
      const cat = await seedCategory(ORG_A, portal, 'Links')

      const link = buildTestPortalLink({
        id: portalLinkId(crypto.randomUUID()),
        categoryId: cat.id,
        portalId: portal.id,
        organizationId: ORG_A,
        propertyId: portal.propertyId,
        label: 'All Links Test',
        sortKey: 'a0',
      })
      await repo.insertLink(ORG_A, link)

      const allLinks = await repo.listAllLinks(ORG_A, portal.id)
      expect(allLinks).toHaveLength(1)
      expect(allLinks[0].label).toBe('All Links Test')
    })

    describe('link texts', () => {
      const insertText = (
        orgId: typeof ORG_A,
        portal: ReturnType<typeof buildTestPortal>,
        linkId: string,
        locale: string,
        label: string,
        line: string | null = null,
      ) =>
        pool.query(
          `INSERT INTO portal_link_texts
             (organization_id, property_id, portal_id, link_id, locale, label, line,
              version, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'user-1', now(), now())`,
          [orgId, portal.propertyId, portal.id, linkId, locale, label, line],
        )

      async function seedLink(
        orgId: typeof ORG_A,
        portal: ReturnType<typeof buildTestPortal>,
        categoryId: ReturnType<typeof portalLinkCategoryId>,
        label: string,
        sortKey: string,
      ) {
        const link = buildTestPortalLink({
          id: portalLinkId(crypto.randomUUID()),
          categoryId,
          portalId: portal.id,
          organizationId: orgId,
          propertyId: portal.propertyId,
          label,
          url: `https://example.test/${sortKey}`,
          sortKey,
        })
        await createPortalLinkRepository(getDb(), () => REPOSITORY_NOW).insertLink(
          orgId,
          link,
        )
        return link
      }

      it('reads stored texts, and the legacy label for a link that has none', async () => {
        const repo = createPortalLinkRepository(getDb(), () => REPOSITORY_NOW)
        const portal = await seedPortal(ORG_A, 'texts-fallback')
        const cat = await seedCategory(ORG_A, portal, 'Links')
        const written = await seedLink(ORG_A, portal, cat.id, 'Old spa', 'a0')
        const legacy = await seedLink(ORG_A, portal, cat.id, 'Old menu', 'a1')
        await insertText(ORG_A, portal, written.id, 'en', 'Spa', 'Open daily')

        const texts = await repo.listLinkTexts(ORG_A, portal.id, 'en')

        expect(
          texts.map((text) => [
            text.linkId,
            text.locale,
            text.label,
            text.line,
            text.source,
          ]),
        ).toEqual([
          [written.id, 'en', 'Spa', 'Open daily', 'text'],
          [legacy.id, 'en', 'Old menu', null, 'legacy_label'],
        ])
      })

      it('puts the primary language first and follows link order', async () => {
        const repo = createPortalLinkRepository(getDb(), () => REPOSITORY_NOW)
        const portal = await seedPortal(ORG_A, 'texts-order')
        const cat = await seedCategory(ORG_A, portal, 'Links')
        const second = await seedLink(ORG_A, portal, cat.id, 'Second', 'b0')
        const first = await seedLink(ORG_A, portal, cat.id, 'First', 'a0')
        await insertText(ORG_A, portal, first.id, 'bg', 'Първи')
        await insertText(ORG_A, portal, first.id, 'en', 'First')
        await insertText(ORG_A, portal, second.id, 'en', 'Second')

        const texts = await repo.listLinkTexts(ORG_A, portal.id, 'bg')

        expect(
          texts.map((text) => `${text.label}:${text.locale}:${text.source}`),
        ).toEqual([
          'Първи:bg:text',
          'First:en:text',
          'Second:bg:legacy_label',
          'Second:en:text',
        ])
      })

      it('tenant-isolates texts', async () => {
        const repo = createPortalLinkRepository(getDb(), () => REPOSITORY_NOW)
        const portalA = await seedPortal(ORG_A, 'texts-tenant-a')
        const portalB = await seedPortal(ORG_B, 'texts-tenant-b')
        const catA = await seedCategory(ORG_A, portalA, 'Cat A')
        const catB = await seedCategory(ORG_B, portalB, 'Cat B')
        const linkA = await seedLink(ORG_A, portalA, catA.id, 'Mine', 'a0')
        const linkB = await seedLink(ORG_B, portalB, catB.id, 'Theirs', 'a0')
        await insertText(ORG_A, portalA, linkA.id, 'en', 'Mine')
        await insertText(ORG_B, portalB, linkB.id, 'en', 'Theirs')

        const asA = await repo.listLinkTexts(ORG_A, portalA.id, 'en')
        const crossRead = await repo.listLinkTexts(ORG_A, portalB.id, 'en')

        expect(asA.map((text) => text.label)).toEqual(['Mine'])
        expect(crossRead).toEqual([])
      })

      it('has the database refuse a locale outside the catalogue', async () => {
        const portal = await seedPortal(ORG_A, 'texts-corrupt')
        const cat = await seedCategory(ORG_A, portal, 'Links')
        const link = await seedLink(ORG_A, portal, cat.id, 'Menu', 'a0')
        await insertText(ORG_A, portal, link.id, 'en', 'Menu')
        await expect(insertText(ORG_A, portal, link.id, 'pt', 'Menu')).rejects.toThrow(
          /portal_link_texts_locale_active/,
        )
      })
    })
  })
})
