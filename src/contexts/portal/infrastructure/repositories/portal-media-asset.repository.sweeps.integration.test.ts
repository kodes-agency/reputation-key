// Portal context — the media asset repository's public read, takedown and sweep
// queries, against real Postgres. The unreferenced check is the one that decides
// whether an image may be deleted, so each place that can hold a reference
// (Brand Profile, link, publication snapshot) is exercised on its own.

import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, portalMediaAssetId, propertyId } from '#/shared/domain/ids'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import type { PortalMediaAsset } from '../../domain/portal-media-asset'
import { createPortalMediaAssetRepository } from './portal-media-asset.repository'

const ORG_A = organizationId('org-sweep-aaaaaaaaaa')
const ORG_B = organizationId('org-sweep-bbbbbbbbbb')
const PROPERTY_A = propertyId('ea100000-0000-4000-8000-000000000001')
const PROPERTY_A2 = propertyId('ea100000-0000-4000-8000-000000000002')
const PROPERTY_B = propertyId('eb100000-0000-4000-8000-000000000001')

const OLD = new Date('2026-09-01T10:00:00Z')
const CUTOFF = new Date('2026-09-20T00:00:00Z')
const FRESH = new Date('2026-09-25T10:00:00Z')
const NOW = new Date('2026-10-01T12:00:00Z')

let pool: Pool

const clean = async () => {
  const orgs = [ORG_A, ORG_B]
  for (const table of [
    'portal_publication_snapshots',
    'portal_links',
    'portal_link_categories',
    'portals',
    'property_portal_brand_profiles',
    'portal_media_assets',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgs])
  }
}

const seed = async () => {
  for (const id of [ORG_A, ORG_B]) {
    const slug = 't-' + id.replace(/-/g, '').slice(-12)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, `Test Org ${slug}`, slug],
    )
  }
  for (const [id, orgId, slug] of [
    [PROPERTY_A, ORG_A, 'sweep-a'],
    [PROPERTY_A2, ORG_A, 'sweep-a2'],
    [PROPERTY_B, ORG_B, 'sweep-b'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, $3, $3, 'UTC')
       ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
      [id, orgId, slug],
    )
  }
}

const insertBrandProfile = (columns: Readonly<Record<string, unknown>> = {}) => {
  const values = {
    id: randomUUID(),
    organization_id: ORG_A,
    property_id: PROPERTY_A,
    display_name: 'Test',
    primary_color: '#112233',
    background_color: '#ffffff',
    text_color: '#000000',
    updated_by: 'user-x',
    ...columns,
  }
  const names = Object.keys(values)
  return pool.query(
    `INSERT INTO property_portal_brand_profiles (${names.join(', ')})
     VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`,
    Object.values(values),
  )
}

const insertPortal = async (property: string = PROPERTY_A) => {
  const portalId = randomUUID()
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug)
     VALUES ($1, $2, $3, $4, 'P', $5)`,
    [portalId, ORG_A, property, property, `p-${portalId.slice(0, 8)}`],
  )
  return portalId
}

const insertLinkWithImage = async (assetId: string) => {
  const portalId = await insertPortal()
  const categoryId = randomUUID()
  await pool.query(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key)
     VALUES ($1, $2, $3, 'C', 'a0')`,
    [categoryId, portalId, ORG_A],
  )
  await pool.query(
    `INSERT INTO portal_links (category_id, portal_id, organization_id, property_id, label, url, legacy_destination_state, sort_key, image_asset_id)
     VALUES ($1, $2, $3, $4, 'L', 'https://example.com', 'unclassified', 'a0', $5)`,
    [categoryId, portalId, ORG_A, PROPERTY_A, assetId],
  )
}

const insertSnapshot = async (configuration: unknown, property: string = PROPERTY_A) => {
  const portalId = await insertPortal(property)
  await pool.query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', now(), 0, 1, 'user-x', now())`,
    [
      randomUUID(),
      ORG_A,
      property,
      portalId,
      'd'.repeat(64),
      JSON.stringify(configuration),
    ],
  )
}

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
})
afterAll(async () => {
  await pool.end()
})
beforeEach(async () => {
  await clean()
  await seed()
})

describe('portalMediaAssetRepository sweeps (integration)', () => {
  const repo = () => createPortalMediaAssetRepository(getDb())
  const asset = (overrides: Partial<PortalMediaAsset> = {}) =>
    buildTestPortalMediaAsset({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      createdAt: OLD,
      ...overrides,
    })
  const store = async (overrides: Partial<PortalMediaAsset> = {}) => {
    const stored = asset(overrides)
    await repo().insert(stored)
    return stored
  }

  describe('public read and servable ids', () => {
    it('reads an asset by its id alone, whatever Organization holds it', async () => {
      const mine = await store()
      const theirs = await store({ organizationId: ORG_B, propertyId: PROPERTY_B })
      expect(await repo().findForPublicRead(mine.id)).toEqual(mine)
      expect(await repo().findForPublicRead(theirs.id)).toEqual(theirs)
      expect(await repo().findForPublicRead(portalMediaAssetId(randomUUID()))).toBeNull()
    })

    it('lists only active assets of the named Property and Organization', async () => {
      const active = await store()
      const otherProperty = await store({ propertyId: PROPERTY_A2 })
      const foreign = await store({ organizationId: ORG_B, propertyId: PROPERTY_B })
      const down = await store()
      await repo().markTakenDown(ORG_A, down.id, NOW)
      const unknown = portalMediaAssetId(randomUUID())

      const ids = await repo().listServableIds(ORG_A, PROPERTY_A, [
        active.id,
        otherProperty.id,
        foreign.id,
        down.id,
        unknown,
      ])
      expect(ids).toEqual([active.id])
    })

    it('answers nothing for no ids', async () => {
      expect(await repo().listServableIds(ORG_A, PROPERTY_A, [])).toEqual([])
    })
  })

  describe('takedown', () => {
    it('stops an active asset being served and keeps its row', async () => {
      const stored = await store()
      const down = await repo().markTakenDown(ORG_A, stored.id, NOW)
      expect(down).toMatchObject({
        id: stored.id,
        status: 'taken_down',
        takenDownAt: NOW,
        objectDeletedAt: null,
      })
      expect(await repo().findById(ORG_A, stored.id)).toEqual(down)
    })

    it('does not take down twice, or an asset of another Organization', async () => {
      const stored = await store()
      expect(await repo().markTakenDown(ORG_B, stored.id, NOW)).toBeNull()
      await repo().markTakenDown(ORG_A, stored.id, NOW)
      expect(await repo().markTakenDown(ORG_A, stored.id, new Date())).toBeNull()
      expect((await repo().findById(ORG_A, stored.id))?.takenDownAt).toEqual(NOW)
    })

    it('records the object removal once, and only for a taken-down asset', async () => {
      const stored = await store()
      await repo().markObjectDeleted(ORG_A, stored.id, NOW)
      expect((await repo().findById(ORG_A, stored.id))?.objectDeletedAt).toBeNull()

      await repo().markTakenDown(ORG_A, stored.id, NOW)
      await repo().markObjectDeleted(ORG_A, stored.id, NOW)
      await repo().markObjectDeleted(ORG_A, stored.id, new Date(NOW.getTime() + 1000))
      expect((await repo().findById(ORG_A, stored.id))?.objectDeletedAt).toEqual(NOW)
    })

    it('sweeps taken-down assets whose object is still there, oldest first', async () => {
      const first = await store()
      const second = await store()
      const done = await store()
      const live = await store()
      await repo().markTakenDown(ORG_A, second.id, new Date('2026-09-30T00:00:00Z'))
      await repo().markTakenDown(ORG_A, first.id, new Date('2026-09-29T00:00:00Z'))
      await repo().markTakenDown(ORG_A, done.id, NOW)
      await repo().markObjectDeleted(ORG_A, done.id, NOW)

      const swept = await repo().listTakenDownWithObject(10)
      expect(swept.map((a) => a.id)).toEqual([first.id, second.id])
      expect(swept.map((a) => a.id)).not.toContain(live.id)
      expect(await repo().listTakenDownWithObject(1)).toHaveLength(1)
    })
  })

  describe('unreferenced sweep', () => {
    const candidates = async () =>
      (await repo().listUnreferencedBefore(CUTOFF, 50)).map((a) => a.id)

    it('lists an old active asset nothing refers to', async () => {
      const lonely = await store()
      expect(await candidates()).toEqual([lonely.id])
    })

    it('leaves out an asset made after the cutoff, and a taken-down one', async () => {
      await store({ createdAt: FRESH })
      const down = await store()
      await repo().markTakenDown(ORG_A, down.id, NOW)
      expect(await candidates()).toEqual([])
    })

    it('lists the oldest first and honours the limit', async () => {
      const newer = await store({ createdAt: new Date('2026-09-05T00:00:00Z') })
      const older = await store({ createdAt: new Date('2026-09-02T00:00:00Z') })
      expect(await candidates()).toEqual([older.id, newer.id])
      expect(await repo().listUnreferencedBefore(CUTOFF, 1)).toHaveLength(1)
    })

    it.each([
      ['a Brand Profile hero', 'hero'],
      ['a Brand Profile logo', 'logo'],
    ] as const)('keeps an asset used as %s', async (_name, purpose) => {
      const used = await store({ purpose })
      await insertBrandProfile(
        purpose === 'hero'
          ? { hero_asset_id: used.id, hero_focal_x: 0.5, hero_focal_y: 0.5 }
          : { logo_asset_id: used.id },
      )
      expect(await candidates()).toEqual([])
    })

    it('keeps an asset used as a link tile picture', async () => {
      const used = await store({ purpose: 'link_image' })
      await insertLinkWithImage(used.id)
      expect(await candidates()).toEqual([])
    })

    it.each([
      ['hero', (id: string) => ({ brandProfile: { hero: { assetId: id } } })],
      ['logo', (id: string) => ({ brandProfile: { logo: { assetId: id } } })],
      [
        'link tile',
        (id: string) => ({
          brandProfile: { logo: null, hero: null },
          links: [{ imageAssetId: null }, { imageAssetId: id }],
        }),
      ],
    ] as const)(
      'keeps an asset a publication snapshot names as its %s',
      async (_name, configuration) => {
        const named = await store()
        await insertSnapshot(configuration(named.id))
        expect(await candidates()).toEqual([])
      },
    )

    it('reads older snapshots that have no media at all as naming nothing', async () => {
      const lonely = await store()
      await insertSnapshot({ schemaVersion: 1, links: 'none' })
      await insertSnapshot({ schemaVersion: 2, brandProfile: null })
      expect(await candidates()).toEqual([lonely.id])
    })

    it('does not let another Property’s snapshot keep an asset', async () => {
      const lonely = await store()
      await insertSnapshot(
        { brandProfile: { hero: { assetId: lonely.id } } },
        PROPERTY_A2,
      )
      expect(await candidates()).toEqual([lonely.id])
    })
  })

  describe('discardIfUnreferenced', () => {
    it('removes the object and then the row of an unreferenced asset', async () => {
      const lonely = await store()
      const removeObject = vi.fn(async () => {
        // Still there while the object goes: the row is only released with it.
        expect(await repo().findById(ORG_A, lonely.id)).not.toBeNull()
      })

      expect(await repo().discardIfUnreferenced(lonely, CUTOFF, removeObject)).toBe(true)
      expect(removeObject).toHaveBeenCalledExactlyOnceWith(lonely.objectKey)
      expect(await repo().findById(ORG_A, lonely.id)).toBeNull()
    })

    it('keeps the row when the object could not be removed', async () => {
      const lonely = await store()
      await expect(
        repo().discardIfUnreferenced(lonely, CUTOFF, async () => {
          throw new Error('store unavailable')
        }),
      ).rejects.toThrow('store unavailable')
      expect(await repo().findById(ORG_A, lonely.id)).not.toBeNull()
    })

    it('leaves an asset that was attached since it was listed', async () => {
      const used = await store({ purpose: 'logo' })
      await insertBrandProfile({ logo_asset_id: used.id })
      const removeObject = vi.fn()
      expect(await repo().discardIfUnreferenced(used, CUTOFF, removeObject)).toBe(false)
      expect(removeObject).not.toHaveBeenCalled()
      expect(await repo().findById(ORG_A, used.id)).not.toBeNull()
    })

    it('leaves an asset a snapshot names, a fresh one, and a taken-down one', async () => {
      const named = await store()
      await insertSnapshot({ brandProfile: { hero: { assetId: named.id } } })
      const fresh = await store({ createdAt: FRESH })
      const down = await store()
      await repo().markTakenDown(ORG_A, down.id, NOW)
      const removeObject = vi.fn()

      expect(await repo().discardIfUnreferenced(named, CUTOFF, removeObject)).toBe(false)
      expect(await repo().discardIfUnreferenced(fresh, CUTOFF, removeObject)).toBe(false)
      expect(await repo().discardIfUnreferenced(down, CUTOFF, removeObject)).toBe(false)
      expect(removeObject).not.toHaveBeenCalled()
    })

    it('is a no-op for an asset that is already gone', async () => {
      const lonely = await store()
      await repo().discardIfUnreferenced(lonely, CUTOFF, async () => {})
      const removeObject = vi.fn()
      expect(await repo().discardIfUnreferenced(lonely, CUTOFF, removeObject)).toBe(false)
      expect(removeObject).not.toHaveBeenCalled()
    })

    it('makes a writer attaching the asset at that moment fail, not point at a deleted image', async () => {
      const lonely = await store({ purpose: 'logo' })
      let attach: Promise<unknown> = Promise.resolve()
      const discarded = await repo().discardIfUnreferenced(lonely, CUTOFF, async () => {
        // The writer starts while the row is locked and has to wait for it.
        attach = insertBrandProfile({ logo_asset_id: lonely.id }).catch(
          (error: unknown) => error,
        )
        await new Promise((resolve) => setTimeout(resolve, 150))
      })

      expect(discarded).toBe(true)
      expect(await attach).toMatchObject({
        constraint: 'property_portal_brand_profiles_logo_asset_fk',
      })
    })
  })
})
