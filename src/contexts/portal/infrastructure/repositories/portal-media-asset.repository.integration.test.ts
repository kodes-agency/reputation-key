// Portal context — portal_media_assets repository and schema integration tests.
// Tenant isolation is NON-NEGOTIABLE; the constraints are the last line of
// defence behind the use case, so each is exercised against real Postgres.

import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, portalMediaAssetId, propertyId } from '#/shared/domain/ids'
import { portalMediaObjectKey } from '#/shared/domain/portal-media'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { createPortalMediaAssetRepository } from './portal-media-asset.repository'

const ORG_A = organizationId('org-media-aaaaaaaaaa')
const ORG_B = organizationId('org-media-bbbbbbbbbb')
const PROPERTY_A = propertyId('ea000000-0000-4000-8000-000000000001')
const PROPERTY_A2 = propertyId('ea000000-0000-4000-8000-000000000002')
const PROPERTY_B = propertyId('eb000000-0000-4000-8000-000000000001')

let pool: Pool

const clean = async () => {
  const orgs = [ORG_A, ORG_B]
  await pool.query('DELETE FROM portal_links WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM portal_link_categories WHERE organization_id = ANY($1)', [
    orgs,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id = ANY($1)', [orgs])
  await pool.query(
    'DELETE FROM property_portal_brand_profiles WHERE organization_id = ANY($1)',
    [orgs],
  )
  await pool.query('DELETE FROM portal_media_assets WHERE organization_id = ANY($1)', [
    orgs,
  ])
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
    [PROPERTY_A, ORG_A, 'media-a'],
    [PROPERTY_A2, ORG_A, 'media-a2'],
    [PROPERTY_B, ORG_B, 'media-b'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, $3, $3, 'UTC')
       ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
      [id, orgId, slug],
    )
  }
}

const insertBrandProfile = (
  orgId: string,
  propId: string,
  columns: Readonly<Record<string, unknown>> = {},
) => {
  const values = {
    id: randomUUID(),
    organization_id: orgId,
    property_id: propId,
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

describe('portalMediaAssetRepository (integration)', () => {
  const repo = () => createPortalMediaAssetRepository(getDb())
  const asset = (overrides = {}) =>
    buildTestPortalMediaAsset({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      ...overrides,
    })

  it('stores an asset and reads it back unchanged', async () => {
    const stored = asset({ purpose: 'logo', width: 600, height: 200 })
    await repo().insert(stored)
    expect(await repo().findById(ORG_A, stored.id)).toEqual(stored)
  })

  it('never returns another Organization an asset it did not store', async () => {
    const stored = asset()
    await repo().insert(stored)
    expect(await repo().findById(ORG_B, stored.id)).toBeNull()
  })

  it('counts active assets per Organization and Property, not taken-down ones', async () => {
    const keep = asset()
    const gone = asset()
    await repo().insert(keep)
    await repo().insert(gone)
    await repo().insert(asset({ propertyId: PROPERTY_A2 }))
    await repo().insert(
      buildTestPortalMediaAsset({ organizationId: ORG_B, propertyId: PROPERTY_B }),
    )
    await pool.query(
      `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = now() WHERE id = $1`,
      [gone.id],
    )
    expect(await repo().countActiveForProperty(ORG_A, PROPERTY_A)).toBe(1)
    expect(await repo().countActiveForProperty(ORG_A, PROPERTY_A2)).toBe(1)
    expect(await repo().countActiveForProperty(ORG_B, PROPERTY_A)).toBe(0)
  })

  describe('schema constraints', () => {
    const refused = (overrides: Record<string, unknown>) => {
      const row = asset()
      const values = {
        id: row.id,
        organization_id: ORG_A,
        property_id: PROPERTY_A,
        purpose: 'hero',
        status: 'active',
        object_key: row.objectKey,
        content_type: 'image/webp',
        width: 100,
        height: 100,
        byte_size: 10,
        content_sha256: 'b'.repeat(64),
        source_format: 'png',
        source_bytes: 10,
        rights_confirmed_at: new Date(),
        created_by: 'user-x',
        ...overrides,
      }
      const names = Object.keys(values)
      return pool.query(
        `INSERT INTO portal_media_assets (${names.join(', ')})
         VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`,
        Object.values(values),
      )
    }

    it('accepts the baseline row the cases below vary', async () => {
      await expect(refused({})).resolves.toBeDefined()
    })

    it.each([
      ['an unknown purpose', { purpose: 'banner' }],
      ['an unknown status', { status: 'deleted' }],
      ['taken down without a time', { status: 'taken_down' }],
      ['a time without being taken down', { taken_down_at: new Date() }],
      [
        'a key that is not derived from the id',
        { object_key: 'portal-media/other.webp' },
      ],
      ['a stored format other than WebP', { content_type: 'image/png' }],
      ['a zero width', { width: 0 }],
      ['a width beyond the snapshot limit', { width: 16_385 }],
      ['no bytes', { byte_size: 0 }],
      ['a malformed hash', { content_sha256: 'XYZ' }],
      ['a source format outside the accepted set', { source_format: 'gif' }],
      ['a Property of another Organization', { organization_id: ORG_B }],
    ])('refuses %s', async (_name, overrides) => {
      await expect(refused(overrides)).rejects.toThrow()
    })

    it('refuses two assets claiming one object', async () => {
      const first = asset()
      await repo().insert(first)
      await expect(
        refused({ id: randomUUID(), object_key: first.objectKey }),
      ).rejects.toThrow()
    })
  })

  describe('references to an asset', () => {
    it('lets a Brand Profile use assets of its own Property', async () => {
      const hero = asset()
      const logo = asset({ purpose: 'logo' })
      await repo().insert(hero)
      await repo().insert(logo)
      await expect(
        insertBrandProfile(ORG_A, PROPERTY_A, {
          hero_asset_id: hero.id,
          hero_focal_x: 0.25,
          hero_focal_y: 0.75,
          logo_asset_id: logo.id,
        }),
      ).resolves.toBeDefined()
    })

    it('refuses a Brand Profile pointing at an asset of another Property', async () => {
      const other = asset({ propertyId: PROPERTY_A2 })
      await repo().insert(other)
      await expect(
        insertBrandProfile(ORG_A, PROPERTY_A, {
          hero_asset_id: other.id,
          hero_focal_x: 0.5,
          hero_focal_y: 0.5,
        }),
      ).rejects.toThrow(/property_portal_brand_profiles_hero_asset_fk/)
      await expect(
        insertBrandProfile(ORG_A, PROPERTY_A, { logo_asset_id: other.id }),
      ).rejects.toThrow(/property_portal_brand_profiles_logo_asset_fk/)
    })

    it('refuses a Brand Profile pointing at another Organization’s asset', async () => {
      const foreign = buildTestPortalMediaAsset({
        organizationId: ORG_B,
        propertyId: PROPERTY_B,
      })
      await repo().insert(foreign)
      await expect(
        insertBrandProfile(ORG_A, PROPERTY_A, {
          hero_asset_id: foreign.id,
          hero_focal_x: 0.5,
          hero_focal_y: 0.5,
        }),
      ).rejects.toThrow()
    })

    it.each([
      ['a hero without a focal point', { hero_focal_x: null, hero_focal_y: null }],
      ['a focal point past the edge', { hero_focal_x: 1.5, hero_focal_y: 0.5 }],
      ['a half-set focal point', { hero_focal_x: 0.5, hero_focal_y: null }],
    ])('refuses %s', async (_name, focal) => {
      const hero = asset()
      await repo().insert(hero)
      await expect(
        insertBrandProfile(ORG_A, PROPERTY_A, { hero_asset_id: hero.id, ...focal }),
      ).rejects.toThrow(/hero_focal_valid/)
    })

    it('refuses a focal point with no hero', async () => {
      await expect(
        insertBrandProfile(ORG_A, PROPERTY_A, { hero_focal_x: 0.5, hero_focal_y: 0.5 }),
      ).rejects.toThrow(/hero_focal_valid/)
    })

    it('keeps an asset that a Brand Profile still uses', async () => {
      const hero = asset()
      await repo().insert(hero)
      await insertBrandProfile(ORG_A, PROPERTY_A, {
        hero_asset_id: hero.id,
        hero_focal_x: 0.5,
        hero_focal_y: 0.5,
      })
      await expect(
        pool.query('DELETE FROM portal_media_assets WHERE id = $1', [hero.id]),
      ).rejects.toThrow(/hero_asset_fk/)
    })

    it('ties a link’s tile image to an asset of the link’s own Property', async () => {
      const portalId = randomUUID()
      await pool.query(
        `INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug)
         VALUES ($1, $2, $3, $4, 'P', 'p')`,
        [portalId, ORG_A, PROPERTY_A, PROPERTY_A],
      )
      const categoryId = randomUUID()
      await pool.query(
        `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key)
         VALUES ($1, $2, $3, 'C', 'a0')`,
        [categoryId, portalId, ORG_A],
      )
      const own = asset({ purpose: 'link_image' })
      const other = asset({ purpose: 'link_image', propertyId: PROPERTY_A2 })
      await repo().insert(own)
      await repo().insert(other)
      const insertLink = (assetId: string) =>
        pool.query(
          `INSERT INTO portal_links (category_id, portal_id, organization_id, property_id, label, url, legacy_destination_state, sort_key, image_asset_id)
           VALUES ($1, $2, $3, $4, 'L', 'https://example.com', 'unclassified', 'a0', $5)`,
          [categoryId, portalId, ORG_A, PROPERTY_A, assetId],
        )
      await expect(insertLink(own.id)).resolves.toBeDefined()
      await expect(insertLink(other.id)).rejects.toThrow(/portal_links_image_asset_fk/)
    })
  })

  it('derives the object key from the id alone', () => {
    const id = portalMediaAssetId('11111111-1111-4111-8111-111111111111')
    expect(portalMediaObjectKey(id)).toBe(
      'portal-media/11111111-1111-4111-8111-111111111111.webp',
    )
  })
})
