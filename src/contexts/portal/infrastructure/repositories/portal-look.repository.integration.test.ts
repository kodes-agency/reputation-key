// A Portal's own look (ADR 0070) against PostgreSQL: what migration 0074's
// table holds and refuses, and what the repository reads back (its saves are
// pinned in portal-look-writes.integration.test.ts). A Portal with no
// row reads as null and follows the whole Property look; a row is read only for
// the Organization, Property and Portal it was written for.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import {
  organizationId,
  portalId,
  portalMediaAssetId,
  propertyId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { createPortalMediaAssetRepository } from './portal-media-asset.repository'
import { createPortalLookRepository } from './portal-look.repository'

const ORG_A = organizationId('org-portal-own-look-000000000000001')
const ORG_B = organizationId('org-portal-own-look-000000000000002')
const PROPERTY = propertyId('7e100000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('7e100000-0000-4000-8000-000000000002')
const PROPERTY_B = propertyId('7e100000-0000-4000-8000-000000000003')
const SPA = portalId('7e200000-0000-4000-8000-000000000001')
const RECEPTION = portalId('7e200000-0000-4000-8000-000000000002')
const ARCHIVED = portalId('7e200000-0000-4000-8000-000000000003')
const DELETED = portalId('7e200000-0000-4000-8000-000000000004')
const QUAY = portalId('7e200000-0000-4000-8000-000000000005')
const PORTAL_B = portalId('7e200000-0000-4000-8000-000000000006')
const HERO = portalMediaAssetId('7e300000-0000-4000-8000-000000000001')
const LOGO = portalMediaAssetId('7e300000-0000-4000-8000-000000000002')
const OTHER_PROPERTY_HERO = portalMediaAssetId('7e300000-0000-4000-8000-000000000003')
const ADMIN = 'admin-portal-own-look-000000000001'
const NOW = new Date('2026-10-26T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['portal_look_overrides', 'portal_media_assets', 'portals', 'properties'],
})

const query = (text: string, values: readonly unknown[] = []) =>
  getPool().query(text, [...values])

const repository = () => createPortalLookRepository(getDb())

async function seedProperty(org: OrganizationId, id: PropertyId, slug: string) {
  await query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'UTC', $4, $4)`,
    [id, org, slug, NOW],
  )
}

async function seedPortal(
  org: OrganizationId,
  property: PropertyId,
  id: string,
  slug: string,
  state: Readonly<{ publicationState?: string; deletedAt?: Date | null }> = {},
) {
  await query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name,
                          slug, publication_state, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, 'property', $8, $4, $4, $5, $6, $6, $7)`,
    [
      id,
      org,
      property,
      slug,
      state.publicationState ?? 'draft',
      NOW,
      state.deletedAt ?? null,
      String(property),
    ],
  )
}

/** A row as migration 0074 holds it; every column a test leaves out takes its default. */
async function insertOverride(columns: Readonly<Record<string, unknown>>) {
  const values = {
    organization_id: ORG_A,
    property_id: PROPERTY,
    portal_id: SPA,
    look_version: 5,
    updated_by: ADMIN,
    ...columns,
  }
  const names = Object.keys(values)
  await query(
    `INSERT INTO portal_look_overrides (${names.join(', ')})
     VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`,
    Object.values(values),
  )
}

const ownEverything = {
  photo_mode: 'own',
  hero_asset_id: HERO,
  hero_focal_x: 0.5,
  hero_focal_y: 0.25,
  hero_alt_texts: JSON.stringify({ en: 'Treatment room', xx: 'unknown', bg: '  ' }),
  colours_mode: 'own',
  primary_color: '#2F855A',
  background_mode: 'manual',
  background_color: '#0B1F14',
  identity_mode: 'own',
  wordmark: 'SPA',
  logo_asset_id: LOGO,
  look_version: 9,
}

beforeEach(async () => {
  await seedProperty(ORG_A, PROPERTY, 'avela-resort')
  await seedProperty(ORG_A, OTHER_PROPERTY, 'quay-house')
  await seedProperty(ORG_B, PROPERTY_B, 'other-tenant')
  await seedPortal(ORG_A, PROPERTY, SPA, 'spa')
  await seedPortal(ORG_A, PROPERTY, RECEPTION, 'reception', {
    publicationState: 'published',
  })
  await seedPortal(ORG_A, PROPERTY, ARCHIVED, 'old-bar', { publicationState: 'archived' })
  await seedPortal(ORG_A, PROPERTY, DELETED, 'gone', { deletedAt: NOW })
  await seedPortal(ORG_A, OTHER_PROPERTY, QUAY, 'quay')
  await seedPortal(ORG_B, PROPERTY_B, PORTAL_B, 'spa')
  const media = createPortalMediaAssetRepository(getDb())
  for (const asset of [
    buildTestPortalMediaAsset({ id: HERO, organizationId: ORG_A, propertyId: PROPERTY }),
    buildTestPortalMediaAsset({
      id: LOGO,
      organizationId: ORG_A,
      propertyId: PROPERTY,
      purpose: 'logo',
    }),
    buildTestPortalMediaAsset({
      id: OTHER_PROPERTY_HERO,
      organizationId: ORG_A,
      propertyId: OTHER_PROPERTY,
    }),
  ]) {
    await media.insert(asset)
  }
})

describe('portal look repository reads', () => {
  it('reads a Portal with no row as following the whole Property look', async () => {
    await expect(repository().findForPortal(ORG_A, PROPERTY, SPA)).resolves.toBeNull()
  })

  it('reads every owned group back, leaving out a description it cannot use', async () => {
    await insertOverride(ownEverything)

    await expect(repository().findForPortal(ORG_A, PROPERTY, SPA)).resolves.toEqual({
      photo: {
        mode: 'own',
        heroAssetId: HERO,
        focalX: 0.5,
        focalY: 0.25,
        altTexts: { en: 'Treatment room' },
      },
      colours: {
        mode: 'own',
        accent: '#2F855A',
        backgroundMode: 'manual',
        backgroundColour: '#0B1F14',
      },
      identity: { mode: 'own', wordmark: 'SPA', logoAssetId: LOGO },
      lookVersion: 9,
    })
  })

  it('reads a row with defaults as following every group, at its own version', async () => {
    await insertOverride({})

    await expect(repository().findForPortal(ORG_A, PROPERTY, SPA)).resolves.toEqual({
      photo: { mode: 'inherit' },
      colours: { mode: 'inherit' },
      identity: { mode: 'inherit' },
      lookVersion: 5,
    })
  })

  it('never reads a row for another Property or another Organization', async () => {
    await insertOverride({ photo_mode: 'none' })

    await expect(
      repository().findForPortal(ORG_A, OTHER_PROPERTY, SPA),
    ).resolves.toBeNull()
    await expect(repository().findForPortal(ORG_B, PROPERTY, SPA)).resolves.toBeNull()
  })

  it('lists the sources of the named Portals that have a row, in one read', async () => {
    await insertOverride({ photo_mode: 'none' })
    await insertOverride({
      portal_id: RECEPTION,
      colours_mode: 'own',
      primary_color: '#B8860B',
      background_mode: 'auto',
      background_color: '#1A1A1A',
    })
    await insertOverride({
      organization_id: ORG_B,
      property_id: PROPERTY_B,
      portal_id: PORTAL_B,
      identity_mode: 'own',
    })

    const rows = await repository().listSourcesForPortals(ORG_A, [
      SPA,
      RECEPTION,
      QUAY,
      PORTAL_B,
    ])

    expect([...rows].sort((a, b) => a.portalId.localeCompare(b.portalId))).toEqual([
      {
        portalId: SPA,
        sources: { photo: 'none', colours: 'property', identity: 'property' },
      },
      {
        portalId: RECEPTION,
        sources: { photo: 'property', colours: 'portal', identity: 'property' },
      },
    ])
    await expect(repository().listSourcesForPortals(ORG_A, [])).resolves.toEqual([])
  })

  it('counts the Property’s live Portals: neither archived nor deleted', async () => {
    await expect(repository().countLivePortals(ORG_A, PROPERTY)).resolves.toBe(2)
    await expect(repository().countLivePortals(ORG_A, OTHER_PROPERTY)).resolves.toBe(1)
    await expect(repository().countLivePortals(ORG_B, PROPERTY)).resolves.toBe(0)
  })
})

describe('migration 0074 holds a row to its rules', () => {
  const refusedBy = async (
    columns: Readonly<Record<string, unknown>>,
    constraint: string,
  ) => expect(insertOverride(columns)).rejects.toMatchObject({ constraint })

  it('keeps one row per Portal', async () => {
    await insertOverride({})
    await expect(insertOverride({ id: randomUUID() })).rejects.toMatchObject({
      constraint: 'portal_look_overrides_portal_unique',
    })
  })

  it('ties the row to a Portal of the same Property', async () => {
    await refusedBy({ portal_id: QUAY }, 'portal_look_overrides_portal_tenant_fk')
  })

  it('ties the own photo and logo to images of the same Property', async () => {
    await refusedBy(
      {
        photo_mode: 'own',
        hero_asset_id: OTHER_PROPERTY_HERO,
        hero_focal_x: 0.5,
        hero_focal_y: 0.5,
      },
      'portal_look_overrides_hero_asset_fk',
    )
    await refusedBy(
      { identity_mode: 'own', logo_asset_id: OTHER_PROPERTY_HERO },
      'portal_look_overrides_logo_asset_fk',
    )
  })

  it('keeps an image from being deleted while a Portal’s look names it', async () => {
    await insertOverride({ identity_mode: 'own', logo_asset_id: LOGO })
    await expect(
      query('DELETE FROM portal_media_assets WHERE organization_id = $1 AND id = $2', [
        ORG_A,
        LOGO,
      ]),
    ).rejects.toMatchObject({ constraint: 'portal_look_overrides_logo_asset_fk' })
  })

  it('wants a photo, inside it, for an own photo, and no photo or description otherwise', async () => {
    await refusedBy({ photo_mode: 'own' }, 'portal_look_overrides_photo_valid')
    await refusedBy(
      { photo_mode: 'own', hero_asset_id: HERO, hero_focal_x: 1.5, hero_focal_y: 0.5 },
      'portal_look_overrides_photo_valid',
    )
    await refusedBy(
      { photo_mode: 'none', hero_alt_texts: JSON.stringify({ en: 'Pool' }) },
      'portal_look_overrides_photo_valid',
    )
    await refusedBy({ photo_mode: 'video' }, 'portal_look_overrides_photo_mode_valid')
    await refusedBy(
      {
        photo_mode: 'own',
        hero_asset_id: HERO,
        hero_focal_x: 0.5,
        hero_focal_y: 0.5,
        hero_alt_texts: JSON.stringify(['Pool']),
      },
      'portal_look_overrides_alt_object',
    )
  })

  it('wants all three colours for own colours, none to follow, and six-digit colours', async () => {
    await refusedBy(
      { colours_mode: 'own', primary_color: '#2F855A' },
      'portal_look_overrides_colours_valid',
    )
    await refusedBy({ primary_color: '#2F855A' }, 'portal_look_overrides_colours_valid')
    await refusedBy(
      {
        colours_mode: 'own',
        primary_color: 'gold',
        background_mode: 'auto',
        background_color: '#0B1F14',
      },
      'portal_look_overrides_palette_valid',
    )
    await refusedBy(
      {
        colours_mode: 'own',
        primary_color: '#2F855A',
        background_mode: 'gradient',
        background_color: '#0B1F14',
      },
      'portal_look_overrides_background_mode_valid',
    )
  })

  it('wants no wordmark or logo while the name follows, and no blank wordmark', async () => {
    await refusedBy({ wordmark: 'SPA' }, 'portal_look_overrides_identity_valid')
    await refusedBy(
      { identity_mode: 'own', wordmark: '   ' },
      'portal_look_overrides_wordmark_present',
    )
    await refusedBy({ look_version: 0 }, 'portal_look_overrides_look_version_positive')
  })
})
