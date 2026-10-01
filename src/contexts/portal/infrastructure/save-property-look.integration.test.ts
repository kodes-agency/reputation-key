// Saving the Property look through the use case and the real Brand Profile
// writer: the colours and wordmark land, the look version moves and the name
// version does not, the images the profile holds survive, only the Portals
// that have been published are told, a look save never confirms an automatic
// public display name, and a name write that lands beside a look save is not
// put back. Real PostgreSQL.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { isPortalError } from '../domain/errors'
import {
  AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR,
  DEFAULT_PROPERTY_BRAND_PALETTE,
} from '../domain/portal-experience'
import { savePropertyLook } from '../application/use-cases/save-property-look'
import { createPortalExperienceRepository } from './repositories/portal-experience.repository'

const ORG_A = organizationId('org-portal-save-look-0000-000000000001')
const ORG_B = organizationId('org-portal-save-look-0000-000000000002')
const PROPERTY = propertyId('7e100000-0000-4000-8000-000000000001')
const ADMIN = userId('admin-portal-save-look-0000000000001')
const NOW = new Date('2026-10-01T10:00:00.000Z')
const LATER = new Date('2026-10-01T11:00:00.000Z')
const LIVE_PORTAL = '7e200000-0000-4000-8000-000000000001'
const DRAFT_PORTAL = '7e200000-0000-4000-8000-000000000002'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
    'portal_page_edits',
    'portal_publication_snapshots',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
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

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Avela Resort', 'avela-resort', 'UTC', $3, $3)`,
    [PROPERTY, ORG_A, NOW],
  )
  await seedPortal(LIVE_PORTAL, 'reception', true)
  await seedPortal(DRAFT_PORTAL, 'bar', false)
  await query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, logo_url, default_hero_image_url,
        primary_color, background_color, text_color, version, look_version, updated_by,
        created_at, updated_at)
     VALUES ($1, $2, $3, 'Avela Resort', 'https://cdn.example.test/logo.png',
             'https://cdn.example.test/hero.png', '#2563EB', '#FFFFFF', '#111827', 5, 3,
             $4, $5, $5)`,
    [randomUUID(), ORG_A, PROPERTY, ADMIN, NOW],
  )
})

const save = (input: Parameters<ReturnType<typeof savePropertyLook>>[0]) =>
  savePropertyLook({
    experienceRepo: createPortalExperienceRepository(getDb()),
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    clock: () => LATER,
  })(
    input,
    buildTestAuthContext({ role: 'AccountAdmin', organizationId: ORG_A, userId: ADMIN }),
  )

async function profileRow() {
  const { rows } = await query(
    `SELECT primary_color, background_color, text_color, background_mode, wordmark,
            logo_url, default_hero_image_url, display_name, updated_by, version, look_version
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

describe.sequential('savePropertyLook (real PostgreSQL)', () => {
  it('writes the accent and wordmark, moves the look version only, and keeps the name, images and text colour', async () => {
    const saved = await save({
      propertyId: PROPERTY,
      accentColour: '#ead6a8',
      backgroundMode: 'auto',
      wordmark: ' AVELA ',
    })

    expect(saved).toMatchObject({
      primaryColor: '#EAD6A8',
      wordmark: 'AVELA',
      version: 5,
      lookVersion: 4,
    })
    await expect(profileRow()).resolves.toMatchObject({
      primary_color: '#EAD6A8',
      text_color: '#111827',
      background_color: '#FFFFFF',
      background_mode: 'auto',
      wordmark: 'AVELA',
      logo_url: 'https://cdn.example.test/logo.png',
      default_hero_image_url: 'https://cdn.example.test/hero.png',
      version: 5,
      look_version: 4,
    })
  })

  it('tells the live portal about each facet that moved, and the draft portal about none', async () => {
    await save({
      propertyId: PROPERTY,
      accentColour: '#EAD6A8',
      backgroundMode: 'auto',
      wordmark: 'AVELA',
    })

    await expect(pendingKeys()).resolves.toEqual([
      { portal_id: LIVE_PORTAL, change_key: 'look:accent' },
      { portal_id: LIVE_PORTAL, change_key: 'look:wordmark' },
    ])
  })

  it('stores a manual background as the field, and a repeat of the same look moves nothing', async () => {
    const input = {
      propertyId: PROPERTY,
      accentColour: '#EAD6A8',
      backgroundMode: 'manual' as const,
      backgroundColour: '#1b1410',
    }
    await save(input)
    await expect(profileRow()).resolves.toMatchObject({
      background_mode: 'manual',
      background_color: '#1B1410',
      look_version: 4,
    })

    await save(input)
    await expect(profileRow()).resolves.toMatchObject({ look_version: 4 })
  })

  it('writes nothing for a manual background that light text cannot be read on', async () => {
    await expect(
      save({
        propertyId: PROPERTY,
        accentColour: '#EAD6A8',
        backgroundMode: 'manual',
        backgroundColour: '#E8E8E8',
      }),
    ).rejects.toSatisfy((error) => isPortalError(error) && error.code === 'invalid_theme')

    await expect(profileRow()).resolves.toMatchObject({
      primary_color: '#2563EB',
      look_version: 3,
    })
    await expect(pendingKeys()).resolves.toEqual([])
  })

  it('saves a wordmark on a Property that still has the default palette accent', async () => {
    await save({
      propertyId: PROPERTY,
      accentColour: DEFAULT_PROPERTY_BRAND_PALETTE.primaryColor,
      backgroundMode: 'auto',
      wordmark: 'AVELA',
    })

    await expect(profileRow()).resolves.toMatchObject({
      primary_color: '#2563EB',
      wordmark: 'AVELA',
      look_version: 4,
    })
    await expect(pendingKeys()).resolves.toEqual([
      { portal_id: LIVE_PORTAL, change_key: 'look:wordmark' },
    ])
  })

  it('does not confirm an automatic public display name, and names the actor only in the ledger', async () => {
    await query(
      `UPDATE property_portal_brand_profiles SET updated_by = $3
       WHERE organization_id = $1 AND property_id = $2`,
      [ORG_A, PROPERTY, AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR],
    )

    await save({
      propertyId: PROPERTY,
      accentColour: '#EAD6A8',
      backgroundMode: 'auto',
      wordmark: 'AVELA',
    })

    await expect(profileRow()).resolves.toMatchObject({
      updated_by: AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR,
    })
    const { rows } = await query(
      `SELECT DISTINCT actor_user_id FROM portal_page_edits WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(rows).toEqual([{ actor_user_id: ADMIN }])
  })

  it('does not put back a display name written while the look save waited for the lock', async () => {
    const holder = await getPool().connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `portal-publication:${ORG_A}:${PROPERTY}`,
      ])
      const pending = save({
        propertyId: PROPERTY,
        accentColour: '#EAD6A8',
        backgroundMode: 'auto',
        wordmark: 'AVELA',
      })
      // Let the save reach the lock, then rename the Property under it.
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
      wordmark: 'AVELA',
      primary_color: '#EAD6A8',
    })
  })

  it('asks for the display name first when the Property has no Brand Profile', async () => {
    await query(`DELETE FROM property_portal_brand_profiles WHERE organization_id = $1`, [
      ORG_A,
    ])

    await expect(
      save({ propertyId: PROPERTY, accentColour: '#EAD6A8', backgroundMode: 'auto' }),
    ).rejects.toSatisfy(
      (error) => isPortalError(error) && error.code === 'brand_profile_missing',
    )
  })
})
