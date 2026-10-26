// What a Property look edit reaches once Portals can have their own look (ADR
// 0070), against PostgreSQL. A Property edit fences only the Portals that
// follow the group it changed, and moves the effective look version of each
// follower that has an override row once for the whole save; a Portal that
// owns the group sees nothing: no pending change, the same draft look, the same
// version. The Property-wide page edit is kept whoever follows. With no
// override rows the fence is the one every published Portal always got, which
// portal-experience-look.repository.integration.test.ts pins.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalId,
  portalMediaAssetId,
  propertyId,
  userId,
  type PortalId,
} from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { applyPortalLook, type PortalLookProfile } from '../domain/portal-look'
import { createPortalExperienceRepository } from './repositories/portal-experience.repository'
import { createPortalLookRepository } from './repositories/portal-look.repository'
import { createPortalMediaAssetRepository } from './repositories/portal-media-asset.repository'

const ORG_A = organizationId('org-property-look-fanout-000000001')
const ORG_B = organizationId('org-property-look-fanout-000000002')
const PROPERTY = propertyId('7f600000-0000-4000-8000-000000000001')
/** Owns its colours, follows the rest. */
const SPA = portalId('7f700000-0000-4000-8000-000000000001')
/** Has a row (its own photo) and follows the colours and the name and logo. */
const RECEPTION = portalId('7f700000-0000-4000-8000-000000000002')
/** No row: follows everything. */
const BAR = portalId('7f700000-0000-4000-8000-000000000003')
const PROPERTY_HERO = '7f800000-0000-4000-8000-000000000001'
const NEW_HERO = '7f800000-0000-4000-8000-000000000002'
const RECEPTION_HERO = '7f800000-0000-4000-8000-000000000003'
const ADMIN = userId('admin-property-look-fanout-0000001')
const NOW = new Date('2026-10-26T10:00:00.000Z')
const LATER = new Date('2026-10-26T11:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_snapshots',
    'portal_look_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_media_assets',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const query = (text: string, values: readonly unknown[] = []) =>
  getPool().query(text, [...values])

const experience = () => createPortalExperienceRepository(getDb())
const scope = { organizationId: ORG_A, propertyId: PROPERTY } as const

async function seedPublishedPortal(id: PortalId, slug: string) {
  await query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name,
                          slug, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, $5, $5, $6, $6)`,
    [id, ORG_A, PROPERTY, String(PROPERTY), slug, NOW],
  )
  await query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', $6, 0, 1, $7, $6)`,
    [randomUUID(), ORG_A, PROPERTY, id, 'c'.repeat(64), NOW, ADMIN],
  )
}

/** A Portal's override as migration 0074 holds it; columns left out take their defaults. */
async function seedOverride(
  portal: PortalId,
  columns: Readonly<Record<string, unknown>>,
) {
  const values = {
    organization_id: ORG_A,
    property_id: PROPERTY,
    portal_id: portal,
    updated_by: 'admin-who-set-it',
    ...columns,
  }
  const names = Object.keys(values)
  await query(
    `INSERT INTO portal_look_overrides (${names.join(', ')})
     VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`,
    Object.values(values),
  )
}

const OWN_COLOURS = {
  colours_mode: 'own',
  primary_color: '#2F855A',
  background_mode: 'manual',
  background_color: '#0B1F14',
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Avela Resort', 'avela-resort', 'UTC', $3, $3)`,
    [PROPERTY, ORG_A, NOW],
  )
  await seedPublishedPortal(SPA, 'spa')
  await seedPublishedPortal(RECEPTION, 'reception')
  await seedPublishedPortal(BAR, 'bar')
  const media = createPortalMediaAssetRepository(getDb())
  for (const id of [PROPERTY_HERO, NEW_HERO, RECEPTION_HERO]) {
    await media.insert(
      buildTestPortalMediaAsset({
        id: portalMediaAssetId(id),
        organizationId: ORG_A,
        propertyId: PROPERTY,
      }),
    )
  }
  await query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, primary_color, background_color,
        text_color, background_mode, wordmark, hero_asset_id, hero_focal_x, hero_focal_y,
        version, look_version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Avela Resort', '#B8860B', '#1A1A1A', '#F5F1E8', 'auto', 'AVELA',
             $4, 0.5, 0.5, 5, 3, $5, $6, $6)`,
    [randomUUID(), ORG_A, PROPERTY, PROPERTY_HERO, ADMIN, NOW],
  )
  await seedOverride(SPA, { ...OWN_COLOURS, look_version: 7 })
  await seedOverride(RECEPTION, {
    photo_mode: 'own',
    hero_asset_id: RECEPTION_HERO,
    hero_focal_x: 0.5,
    hero_focal_y: 0.5,
    look_version: 4,
  })
})

const saveLook = (look: Readonly<{ primaryColor: string; wordmark?: string | null }>) =>
  experience().savePropertyLook({
    ...scope,
    look: { backgroundMode: 'auto', ...look },
    actorUserId: ADMIN,
    at: LATER,
  })

async function pendingRows() {
  const { rows } = await query(
    `SELECT portal_id::text AS portal_id, change_kind, change_key, source_version
     FROM portal_pending_content_changes WHERE organization_id = $1
     ORDER BY portal_id, change_kind, change_key`,
    [ORG_A],
  )
  return rows
}

async function pageEditRows() {
  const { rows } = await query(
    `SELECT portal_id::text AS portal_id, change_kind, change_key
     FROM portal_page_edits WHERE organization_id = $1 ORDER BY change_kind, change_key`,
    [ORG_A],
  )
  return rows
}

async function lookVersions() {
  const { rows } = await query(
    `SELECT portal_id::text AS portal_id, look_version, updated_by
     FROM portal_look_overrides WHERE organization_id = $1 ORDER BY portal_id`,
    [ORG_A],
  )
  return Object.fromEntries(rows.map((row) => [row.portal_id, row]))
}

/** What a Portal's draft shows of the look: the Brand Profile with its own groups laid over. */
async function draftLookOf(portal: PortalId): Promise<PortalLookProfile> {
  const [{ profile }, override] = await Promise.all([
    experience().getPropertyExperience(ORG_A, PROPERTY),
    createPortalLookRepository(getDb()).findForPortal(ORG_A, PROPERTY, portal),
  ])
  if (!profile) throw new Error('expected the Brand Profile')
  const look = applyPortalLook(profile, override)
  return {
    primaryColor: look.primaryColor,
    backgroundColor: look.backgroundColor,
    backgroundMode: look.backgroundMode,
    wordmark: look.wordmark,
    logoAssetId: look.logoAssetId,
    heroAssetId: look.heroAssetId,
    heroFocalX: look.heroFocalX,
    heroFocalY: look.heroFocalY,
    lookVersion: look.lookVersion,
  }
}

describe.sequential(
  'Property look edits and Portals with their own look (real PostgreSQL)',
  () => {
    it('fences and moves only the Portals that follow the colours on an accent edit', async () => {
      const spaBefore = await draftLookOf(SPA)

      await saveLook({ primaryColor: '#C8A45A' })

      await expect(pendingRows()).resolves.toEqual([
        {
          portal_id: RECEPTION,
          change_kind: 'property_brand_profile',
          change_key: 'look:accent',
          source_version: 'v4',
        },
        {
          portal_id: BAR,
          change_kind: 'property_brand_profile',
          change_key: 'look:accent',
          source_version: 'v4',
        },
      ])
      await expect(lookVersions()).resolves.toMatchObject({
        [SPA]: { look_version: 7 },
        // The Portal's own look did not change hands: who last saved it stays.
        [RECEPTION]: { look_version: 5, updated_by: 'admin-who-set-it' },
      })
      // The Spa's own colours: its draft shows exactly what it showed.
      await expect(draftLookOf(SPA)).resolves.toEqual(spaBefore)
      await expect(draftLookOf(RECEPTION)).resolves.toMatchObject({
        primaryColor: '#C8A45A',
        lookVersion: 5,
      })
    })

    it('moves a follower once for a save that changes several facets', async () => {
      await saveLook({ primaryColor: '#C8A45A', wordmark: 'AVELA RESORT' })

      await expect(lookVersions()).resolves.toMatchObject({
        // Follows the name and logo only: fenced for the wordmark, moved once.
        [SPA]: { look_version: 8 },
        [RECEPTION]: { look_version: 5 },
      })
      const keysOf = (portal: string) =>
        pendingRows().then((rows) =>
          rows.filter((row) => row.portal_id === portal).map((row) => row.change_key),
        )
      await expect(keysOf(SPA)).resolves.toEqual(['look:wordmark'])
      await expect(keysOf(RECEPTION)).resolves.toEqual(['look:accent', 'look:wordmark'])
      await expect(keysOf(BAR)).resolves.toEqual(['look:accent', 'look:wordmark'])
    })

    it('keeps the Property-wide page edit when no Portal follows the change', async () => {
      await query(
        `UPDATE portal_look_overrides SET colours_mode = 'own', primary_color = '#2F855A',
              background_mode = 'auto', background_color = '#0B1F14'
       WHERE organization_id = $1 AND portal_id = $2`,
        [ORG_A, RECEPTION],
      )
      await seedOverride(BAR, { ...OWN_COLOURS, look_version: 3 })

      await saveLook({ primaryColor: '#C8A45A' })

      await expect(pendingRows()).resolves.toEqual([])
      await expect(pageEditRows()).resolves.toEqual([
        {
          portal_id: null,
          change_kind: 'property_brand_profile',
          change_key: 'look:accent',
        },
      ])
      await expect(lookVersions()).resolves.toMatchObject({
        [SPA]: { look_version: 7 },
        [RECEPTION]: { look_version: 4 },
        [BAR]: { look_version: 3 },
      })
    })

    it('reaches neither a Portal with its own photo nor one with no photo on a photo edit', async () => {
      await query(
        `UPDATE portal_look_overrides SET photo_mode = 'none'
       WHERE organization_id = $1 AND portal_id = $2`,
        [ORG_A, SPA],
      )

      await experience().savePropertyHero({
        ...scope,
        hero: { assetId: NEW_HERO },
        altTexts: [{ id: randomUUID(), locale: 'en', text: 'The new pool' }],
        actorUserId: ADMIN,
        at: LATER,
      })

      // Only the Bar shows the Property's photo, and so its description.
      await expect(pendingRows()).resolves.toEqual([
        {
          portal_id: BAR,
          change_kind: 'property_brand_content',
          change_key: 'en',
          source_version: 'v1',
        },
        {
          portal_id: BAR,
          change_kind: 'property_brand_profile',
          change_key: 'look:photo',
          source_version: 'v4',
        },
      ])
      await expect(lookVersions()).resolves.toMatchObject({
        [SPA]: { look_version: 7 },
        [RECEPTION]: { look_version: 4 },
      })
      // The description is named as the photo's, not as welcome text.
      await expect(pageEditRows()).resolves.toEqual([
        {
          portal_id: null,
          change_kind: 'property_brand_content',
          change_key: 'photo_alt:en',
        },
        {
          portal_id: null,
          change_kind: 'property_brand_profile',
          change_key: 'look:photo',
        },
      ])
    })

    it('still reaches every Portal with a new public display name', async () => {
      await experience().savePropertyDisplayName({
        id: randomUUID(),
        ...scope,
        displayName: 'Avela Resort & Spa',
        updatedBy: ADMIN,
        at: LATER,
      })

      expect((await pendingRows()).map((row) => [row.portal_id, row.change_key])).toEqual(
        [
          [SPA, 'all'],
          [RECEPTION, 'all'],
          [BAR, 'all'],
        ],
      )
      // The name is not the look: no Portal's look version moves.
      await expect(lookVersions()).resolves.toMatchObject({
        [SPA]: { look_version: 7 },
        [RECEPTION]: { look_version: 4 },
      })
    })

    it('never moves another tenant’s rows', async () => {
      const otherProperty = propertyId('7f600000-0000-4000-8000-000000000002')
      const otherPortal = portalId('7f700000-0000-4000-8000-000000000009')
      await query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Elsewhere', 'elsewhere', 'UTC', $3, $3)`,
        [otherProperty, ORG_B, NOW],
      )
      await query(
        `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name,
                            slug, created_at, updated_at)
       VALUES ($1, $2, $3, 'property', $4, 'spa', 'spa', $5, $5)`,
        [otherPortal, ORG_B, otherProperty, String(otherProperty), NOW],
      )
      await query(
        `INSERT INTO portal_look_overrides (organization_id, property_id, portal_id,
                                          photo_mode, look_version, updated_by)
       VALUES ($1, $2, $3, 'none', 2, 'someone-else')`,
        [ORG_B, otherProperty, otherPortal],
      )

      await saveLook({ primaryColor: '#C8A45A' })

      const { rows } = await query(
        `SELECT look_version FROM portal_look_overrides WHERE organization_id = $1`,
        [ORG_B],
      )
      expect(rows).toEqual([{ look_version: 2 }])
    })
  },
)
