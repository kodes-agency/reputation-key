// The Property look's photograph and logo through the use cases and the real
// Brand Profile writer (round 4, slice 42c2): the asset ids and the focal point
// land, the look version and the live Portals' pending changes move as for any
// look edit, the name, colours and who last saved the profile stay, taking the
// photograph off clears its focal point, a description is kept in the language's
// wording row (which is created holding the description alone when the language
// has none), and the database itself keeps the profile to its own Property's
// images. Real PostgreSQL.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { isPortalError } from '../domain/errors'
import {
  savePropertyHero,
  savePropertyLogo,
} from '../application/use-cases/save-property-media'
import { createPortalExperienceRepository } from './repositories/portal-experience.repository'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'

const ORG_A = organizationId('org-portal-save-media-0000-000000000001')
const ORG_B = organizationId('org-portal-save-media-0000-000000000002')
const PROPERTY = propertyId('7f100000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('7f100000-0000-4000-8000-000000000002')
const ADMIN = userId('admin-portal-save-media-000000000001')
const NOW = new Date('2026-10-01T10:00:00.000Z')
const LATER = new Date('2026-10-01T11:00:00.000Z')
const LIVE_PORTAL = '7f200000-0000-4000-8000-000000000001'
const DRAFT_PORTAL = '7f200000-0000-4000-8000-000000000002'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_snapshots',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_media_assets',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const query = (text: string, values: readonly unknown[]) =>
  getPool().query(text, [...values])

async function seedPortal(id: string, slug: string, published: boolean) {
  await query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name,
                          slug, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, $5, $5, $6, $6)`,
    [id, ORG_A, PROPERTY, `${PROPERTY}`, slug, NOW],
  )
  if (!published) return
  await query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', $6, 0, 1, $7, $6)`,
    [randomUUID(), ORG_A, PROPERTY, id, 'a'.repeat(64), NOW, ADMIN],
  )
}

async function insertAsset(
  purpose: 'hero' | 'logo' | 'link_image',
  property = PROPERTY,
  overrides: Parameters<typeof buildTestPortalMediaAsset>[0] = {},
) {
  const asset = buildTestPortalMediaAsset({
    organizationId: ORG_A,
    propertyId: property,
    purpose,
    createdBy: ADMIN,
    ...overrides,
  })
  await createPortalMediaAssetRepository(getDb()).insert(asset)
  return asset
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  for (const [id, slug] of [
    [PROPERTY, 'avela-resort'],
    [OTHER_PROPERTY, 'avela-annex'],
  ] as const) {
    await query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'UTC', $4, $4)`,
      [id, ORG_A, slug, NOW],
    )
  }
  await seedPortal(LIVE_PORTAL, 'reception', true)
  await seedPortal(DRAFT_PORTAL, 'bar', false)
  await query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, primary_color, background_color,
        text_color, version, look_version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Avela Resort', '#2563EB', '#FFFFFF', '#111827', 5, 3, $4, $5, $5)`,
    [randomUUID(), ORG_A, PROPERTY, ADMIN, NOW],
  )
})

const deps = () => ({
  experienceRepo: createPortalExperienceRepository(getDb()),
  mediaRepo: createPortalMediaAssetRepository(getDb()),
  staffPublicApi: {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  },
  idGen: () => randomUUID(),
  clock: () => LATER,
})
const admin = () =>
  buildTestAuthContext({ role: 'AccountAdmin', organizationId: ORG_A, userId: ADMIN })
const setHero = (input: Parameters<ReturnType<typeof savePropertyHero>>[0]) =>
  savePropertyHero(deps())(input, admin())
const setLogo = (input: Parameters<ReturnType<typeof savePropertyLogo>>[0]) =>
  savePropertyLogo(deps())(input, admin())

async function profileRow() {
  const { rows } = await query(
    `SELECT hero_asset_id, hero_focal_x, hero_focal_y, logo_asset_id, display_name,
            primary_color, updated_by, version, look_version
     FROM property_portal_brand_profiles WHERE organization_id = $1 AND property_id = $2`,
    [ORG_A, PROPERTY],
  )
  return rows[0]
}

async function pendingKeys() {
  const { rows } = await query(
    `SELECT portal_id::text AS portal_id, change_key
     FROM portal_pending_content_changes WHERE organization_id = $1
     ORDER BY portal_id, change_key`,
    [ORG_A],
  )
  return rows as ReadonlyArray<{ portal_id: string; change_key: string }>
}

async function contentRow(locale: string) {
  const { rows } = await query(
    `SELECT title, short_description, hero_alt_text, version
     FROM property_portal_brand_contents
     WHERE organization_id = $1 AND property_id = $2 AND locale = $3`,
    [ORG_A, PROPERTY, locale],
  )
  return rows[0]
}

describe.sequential('saving the Property look media (real PostgreSQL)', () => {
  it('writes the photograph and its focal point, moves the look version only, and tells the live portal about the images', async () => {
    const asset = await insertAsset('hero')

    const saved = await setHero({
      propertyId: PROPERTY,
      assetId: asset.id,
      focalX: 0.5,
      focalY: 0.42,
    })

    expect(saved.media.hero).toMatchObject({
      assetId: asset.id,
      focalX: 0.5,
      focalY: 0.42,
      width: 2400,
      height: 1600,
    })
    await expect(profileRow()).resolves.toMatchObject({
      hero_asset_id: asset.id,
      hero_focal_x: 0.5,
      hero_focal_y: 0.42,
      display_name: 'Avela Resort',
      primary_color: '#2563EB',
      updated_by: ADMIN,
      version: 5,
      look_version: 4,
    })
    await expect(pendingKeys()).resolves.toEqual([
      { portal_id: LIVE_PORTAL, change_key: 'look:images' },
    ])
  })

  it('moves the look version once for a new focal point, and not at all for the same one', async () => {
    const asset = await insertAsset('hero')
    await setHero({ propertyId: PROPERTY, assetId: asset.id, focalX: 0.5, focalY: 0.5 })

    await setHero({ propertyId: PROPERTY, assetId: asset.id, focalX: 0.3, focalY: 0.6 })
    await expect(profileRow()).resolves.toMatchObject({
      hero_focal_x: 0.3,
      hero_focal_y: 0.6,
      look_version: 5,
    })

    await setHero({ propertyId: PROPERTY, assetId: asset.id, focalX: 0.3, focalY: 0.6 })
    await expect(profileRow()).resolves.toMatchObject({ look_version: 5 })
  })

  it('clears the focal point with the photograph, and leaves the descriptions it was given alone', async () => {
    const asset = await insertAsset('hero')
    await setHero({
      propertyId: PROPERTY,
      assetId: asset.id,
      altTexts: [{ locale: 'en', text: 'Evening on the sea terrace' }],
    })

    const saved = await setHero({ propertyId: PROPERTY, assetId: null })

    expect(saved.media.hero).toBeNull()
    await expect(profileRow()).resolves.toMatchObject({
      hero_asset_id: null,
      hero_focal_x: null,
      hero_focal_y: null,
      look_version: 5,
    })
    await expect(contentRow('en')).resolves.toMatchObject({
      hero_alt_text: 'Evening on the sea terrace',
    })
  })

  it('keeps the description in a language that has no wording yet, as a row that holds nothing else', async () => {
    const asset = await insertAsset('hero')

    await setHero({
      propertyId: PROPERTY,
      assetId: asset.id,
      altTexts: [{ locale: 'en', text: 'Evening on the sea terrace' }],
    })

    await expect(contentRow('en')).resolves.toEqual({
      title: '',
      short_description: '',
      hero_alt_text: 'Evening on the sea terrace',
      version: 1,
    })
    await expect(pendingKeys()).resolves.toEqual([
      { portal_id: LIVE_PORTAL, change_key: 'en' },
      { portal_id: LIVE_PORTAL, change_key: 'look:images' },
    ])
  })

  it('changes only the description of a language that has wording, and clears one', async () => {
    const asset = await insertAsset('hero')
    await query(
      `INSERT INTO property_portal_brand_contents
         (id, organization_id, property_id, locale, title, short_description, hero_alt_text,
          version, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'bg', 'Авела', 'Курорт на морето', 'Старо описание', 4, $4, $5, $5)`,
      [randomUUID(), ORG_A, PROPERTY, ADMIN, NOW],
    )

    await setHero({
      propertyId: PROPERTY,
      assetId: asset.id,
      altTexts: [{ locale: 'bg', text: 'Вечер на терасата' }],
    })
    await expect(contentRow('bg')).resolves.toEqual({
      title: 'Авела',
      short_description: 'Курорт на морето',
      hero_alt_text: 'Вечер на терасата',
      version: 5,
    })

    await setHero({
      propertyId: PROPERTY,
      assetId: asset.id,
      altTexts: [{ locale: 'bg', text: null }],
    })
    await expect(contentRow('bg')).resolves.toMatchObject({
      hero_alt_text: null,
      title: 'Авела',
    })
  })

  it('does not touch a language it was not given a description for, or write a row for an unchanged one', async () => {
    const asset = await insertAsset('hero')
    await setHero({
      propertyId: PROPERTY,
      assetId: asset.id,
      altTexts: [{ locale: 'en', text: 'Evening on the sea terrace' }],
    })

    await setHero({
      propertyId: PROPERTY,
      assetId: asset.id,
      altTexts: [{ locale: 'en', text: 'Evening on the sea terrace' }],
    })
    await setHero({ propertyId: PROPERTY, assetId: asset.id })

    await expect(contentRow('en')).resolves.toMatchObject({ version: 1 })
    await expect(contentRow('bg')).resolves.toBeUndefined()
  })

  it('writes the logo, and takes it off', async () => {
    const asset = await insertAsset('logo', PROPERTY, { width: 480, height: 120 })

    const saved = await setLogo({ propertyId: PROPERTY, assetId: asset.id })

    expect(saved.media.logo).toMatchObject({ assetId: asset.id, width: 480, height: 120 })
    await expect(profileRow()).resolves.toMatchObject({
      logo_asset_id: asset.id,
      look_version: 4,
      updated_by: ADMIN,
    })
    await expect(pendingKeys()).resolves.toEqual([
      { portal_id: LIVE_PORTAL, change_key: 'look:images' },
    ])

    await setLogo({ propertyId: PROPERTY, assetId: null })
    await expect(profileRow()).resolves.toMatchObject({
      logo_asset_id: null,
      look_version: 5,
    })
  })

  it('does not confirm an automatic public display name', async () => {
    const asset = await insertAsset('logo')
    await query(
      `UPDATE property_portal_brand_profiles SET updated_by = 'system:public-display-name-default'
       WHERE organization_id = $1 AND property_id = $2`,
      [ORG_A, PROPERTY],
    )

    await setLogo({ propertyId: PROPERTY, assetId: asset.id })

    await expect(profileRow()).resolves.toMatchObject({
      updated_by: 'system:public-display-name-default',
    })
  })

  it('refuses an image of another Property, a taken-down one and one of the wrong purpose, writing nothing', async () => {
    const foreign = await insertAsset('hero', OTHER_PROPERTY)
    const takenDown = await insertAsset('hero', PROPERTY, {
      status: 'taken_down',
      takenDownAt: NOW,
    })
    const tilePicture = await insertAsset('link_image')

    for (const asset of [foreign, takenDown, tilePicture]) {
      await expect(
        setHero({ propertyId: PROPERTY, assetId: asset.id }),
      ).rejects.toSatisfy(
        (error) => isPortalError(error) && error.code === 'media_not_found',
      )
    }
    await expect(profileRow()).resolves.toMatchObject({
      hero_asset_id: null,
      look_version: 3,
    })
    await expect(pendingKeys()).resolves.toEqual([])
  })

  it('does not put back a display name written while the save waited for the lock', async () => {
    const asset = await insertAsset('hero')
    const holder = await getPool().connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `portal-publication:${ORG_A}:${PROPERTY}`,
      ])
      const pending = setHero({ propertyId: PROPERTY, assetId: asset.id })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await holder.query(
        `UPDATE property_portal_brand_profiles SET display_name = 'Avela Grand', version = 6
         WHERE organization_id = $1 AND property_id = $2`,
        [ORG_A, PROPERTY],
      )
      await holder.query('COMMIT')
      await pending
    } finally {
      holder.release()
    }

    await expect(profileRow()).resolves.toMatchObject({
      display_name: 'Avela Grand',
      version: 6,
      hero_asset_id: asset.id,
    })
  })

  it('asks for the display name first when the Property has no Brand Profile', async () => {
    const asset = await insertAsset('logo')
    await query(`DELETE FROM property_portal_brand_profiles WHERE organization_id = $1`, [
      ORG_A,
    ])

    await expect(setLogo({ propertyId: PROPERTY, assetId: asset.id })).rejects.toSatisfy(
      (error) => isPortalError(error) && error.code === 'brand_profile_missing',
    )
  })
})
