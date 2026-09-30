// The Property look: what a look edit, a name edit and a default-language edit
// each move. `version` is what AI reply drafts fence on, so it moves only with
// the public display name; `look_version` moves with the look; default
// languages only seed new Portals and so move nothing and notify no Portal.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createPortalAiReplyBrandProfileAuthority } from '../ai-reply-brand-profile-authority'
import { createPortalExperienceRepository } from './portal-experience.repository'

const ORG_A = organizationId('org-portal-look-0000-0000-000000000001')
const ORG_B = organizationId('org-portal-look-0000-0000-000000000002')
const PROPERTY = propertyId('7d100000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('7d100000-0000-4000-8000-000000000002')
const ADMIN = userId('admin-portal-look-0000000000000001')
const SECOND_ADMIN = userId('admin-portal-look-0000000000000002')
const NOW = new Date('2026-10-01T10:00:00.000Z')
const LATER = new Date('2026-10-01T11:00:00.000Z')
const LATEST = new Date('2026-10-01T12:00:00.000Z')
const PUBLISHED_PORTALS = [
  '7d200000-0000-4000-8000-000000000001',
  '7d200000-0000-4000-8000-000000000002',
] as const
const DRAFT_PORTAL = '7d200000-0000-4000-8000-000000000003'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
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
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', $3, $3),
            ($4, $2, 'Quay House', 'quay-house', 'UTC', $3, $3)`,
    [PROPERTY, ORG_A, NOW, OTHER_PROPERTY],
  )
  await seedPortal(PUBLISHED_PORTALS[0], 'reception', true)
  await seedPortal(PUBLISHED_PORTALS[1], 'spa', true)
  await seedPortal(DRAFT_PORTAL, 'bar', false)
  await query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, primary_color,
        background_color, text_color, version, look_version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Harbour House', '#2563EB', '#FFFFFF', '#111827', 5, 3, $4, $5, $5)`,
    [randomUUID(), ORG_A, PROPERTY, ADMIN, NOW],
  )
})

const repository = () => createPortalExperienceRepository(getDb())

type ProfileInput = Parameters<
  ReturnType<typeof createPortalExperienceRepository>['savePropertyProfile']
>[0]['profile']

const baseProfile: ProfileInput = {
  displayName: 'Harbour House',
  logoUrl: null,
  defaultHeroImageUrl: null,
  primaryColor: '#2563EB',
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
}

const saveProfile = (
  profile: Partial<ProfileInput> &
    Readonly<{ wordmark?: string | null; backgroundMode?: 'auto' | 'manual' }>,
  by = ADMIN,
  at = LATER,
) =>
  repository().savePropertyProfile({
    id: randomUUID(),
    organizationId: ORG_A,
    propertyId: PROPERTY,
    profile: { ...baseProfile, ...profile },
    updatedBy: by,
    at,
  })

async function profileRow() {
  const { rows } = await query(
    `SELECT display_name, primary_color, version, look_version, wordmark,
            background_mode, default_guest_locales, updated_by, updated_at
     FROM property_portal_brand_profiles WHERE organization_id = $1 AND property_id = $2`,
    [ORG_A, PROPERTY],
  )
  return rows[0]
}

async function pendingRows() {
  const { rows } = await query(
    `SELECT portal_id::text AS portal_id, change_kind, change_key, source_version
     FROM portal_pending_content_changes WHERE organization_id = $1
     ORDER BY portal_id, change_kind, change_key`,
    [ORG_A],
  )
  return rows as ReadonlyArray<{
    portal_id: string
    change_kind: string
    change_key: string
    source_version: string
  }>
}

async function brandEventCount(): Promise<number> {
  const { rows } = await query(
    `SELECT count(*)::int AS count FROM outbox_events
     WHERE organization_id = $1 AND event_type = 'portal.property_brand_profile.updated'`,
    [ORG_A],
  )
  return rows[0].count
}

describe.sequential('Property look writes (real PostgreSQL)', () => {
  it('moves the look version, not the name version, when the look changes', async () => {
    const saved = await saveProfile({
      primaryColor: '#C8A45A',
      backgroundColor: '#14110F',
      textColor: '#F5F1E8',
      wordmark: 'HARBOUR',
      backgroundMode: 'manual',
    })

    expect(saved).toMatchObject({
      version: 5,
      lookVersion: 4,
      wordmark: 'HARBOUR',
      backgroundMode: 'manual',
      primaryColor: '#C8A45A',
      updatedBy: ADMIN,
    })
    await expect(profileRow()).resolves.toMatchObject({
      version: 5,
      look_version: 4,
      wordmark: 'HARBOUR',
      background_mode: 'manual',
    })
  })

  it('leaves AI reply drafts current after a look edit, and stale after a rename', async () => {
    const authority = createPortalAiReplyBrandProfileAuthority(getDb())
    const before = await authority.readCurrentAiReplyBrandProfile(ORG_A, PROPERTY)
    if (!before) throw new Error('expected a profile')
    const isCurrent = () =>
      getDb().transaction((tx) =>
        authority.isCurrentAiReplyBrandProfile(tx, {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          version: before.version,
          displayNameDigest: before.displayNameDigest,
        }),
      )

    await saveProfile({ primaryColor: '#C8A45A', wordmark: 'HARBOUR' })
    await expect(isCurrent()).resolves.toBe(true)
    await expect(
      authority.readCurrentAiReplyBrandProfile(ORG_A, PROPERTY),
    ).resolves.toEqual(before)

    await saveProfile({ displayName: 'Harbour House Hotel' })
    await expect(isCurrent()).resolves.toBe(false)
  })

  it('records one look row per facet for each Portal that has been published, and none for a draft', async () => {
    await saveProfile({ primaryColor: '#C8A45A', wordmark: 'HARBOUR' })

    const rows = await pendingRows()
    const first = PUBLISHED_PORTALS[0]
    const second = PUBLISHED_PORTALS[1]
    expect(rows).toEqual([
      {
        portal_id: first,
        change_kind: 'property_brand_profile',
        change_key: 'look:accent',
        source_version: 'v4',
      },
      {
        portal_id: first,
        change_kind: 'property_brand_profile',
        change_key: 'look:wordmark',
        source_version: 'v4',
      },
      {
        portal_id: second,
        change_kind: 'property_brand_profile',
        change_key: 'look:accent',
        source_version: 'v4',
      },
      {
        portal_id: second,
        change_kind: 'property_brand_profile',
        change_key: 'look:wordmark',
        source_version: 'v4',
      },
    ])
    expect(rows.some((row) => row.portal_id === DRAFT_PORTAL)).toBe(false)
    expect(rows.some((row) => row.change_key === 'all')).toBe(false)
  })

  it('names the field facet for a background mode or colour change', async () => {
    await saveProfile({ backgroundMode: 'manual', backgroundColor: '#000000' })
    const keys = (await pendingRows()).map((row) => row.change_key)
    expect(new Set(keys)).toEqual(new Set(['look:field']))
  })

  it('records the name fence, and no look row, when only the name changes', async () => {
    const saved = await saveProfile({ displayName: 'Harbour House Hotel' })

    expect(saved).toMatchObject({ version: 6, lookVersion: 3 })
    const rows = await pendingRows()
    expect(rows.map((row) => [row.change_key, row.source_version])).toEqual([
      ['all', 'v6'],
      ['all', 'v6'],
    ])
    await expect(brandEventCount()).resolves.toBe(1)
  })

  it('records both fences when the name and the look change together', async () => {
    const saved = await saveProfile({ displayName: 'Harbour', textColor: '#000000' })

    expect(saved).toMatchObject({ version: 6, lookVersion: 4 })
    const keys = (await pendingRows()).map((row) => [row.change_key, row.source_version])
    expect(keys).toContainEqual(['all', 'v6'])
    expect(keys).toContainEqual(['look:text', 'v4'])
    expect(keys).toHaveLength(4)
  })

  it('announces a look edit with the unchanged profile version', async () => {
    await saveProfile({ primaryColor: '#C8A45A' })
    const { rows } = await query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'portal.property_brand_profile.updated'`,
      [ORG_A],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ profileVersion: 5 })
  })

  it('treats a save that changes nothing as a confirmation: who, no versions, no fences, no event', async () => {
    const saved = await saveProfile({}, SECOND_ADMIN)

    expect(saved).toMatchObject({ version: 5, lookVersion: 3, updatedBy: SECOND_ADMIN })
    await expect(profileRow()).resolves.toMatchObject({
      version: 5,
      look_version: 3,
      updated_by: SECOND_ADMIN,
    })
    await expect(pendingRows()).resolves.toEqual([])
    await expect(brandEventCount()).resolves.toBe(0)
  })

  it('keeps the wordmark and background mode a caller does not mention, and clears a wordmark given as null', async () => {
    await saveProfile({ wordmark: 'HARBOUR', backgroundMode: 'manual' })
    await saveProfile({ primaryColor: '#C8A45A' }, ADMIN, LATEST)
    await expect(profileRow()).resolves.toMatchObject({
      wordmark: 'HARBOUR',
      background_mode: 'manual',
      look_version: 5,
    })

    await saveProfile({ wordmark: null }, ADMIN, LATEST)
    await expect(profileRow()).resolves.toMatchObject({ wordmark: null, look_version: 6 })
  })

  it('never touches the default languages when a profile is saved', async () => {
    await query(
      `UPDATE property_portal_brand_profiles SET default_guest_locales = '["bg","en"]'::jsonb
       WHERE organization_id = $1`,
      [ORG_A],
    )
    await saveProfile({ primaryColor: '#C8A45A', displayName: 'Harbour' })
    await expect(profileRow()).resolves.toMatchObject({
      default_guest_locales: ['bg', 'en'],
    })
  })

  it('creates a first profile at version 1 and look version 1, automatic background, English', async () => {
    const created = await repository().savePropertyProfile({
      id: randomUUID(),
      organizationId: ORG_A,
      propertyId: OTHER_PROPERTY,
      profile: { ...baseProfile, displayName: 'Quay House', wordmark: 'QUAY' },
      updatedBy: ADMIN,
      at: NOW,
    })

    expect(created).toMatchObject({
      version: 1,
      lookVersion: 1,
      wordmark: 'QUAY',
      backgroundMode: 'auto',
      defaultGuestLocales: ['en'],
    })
  })
})

describe.sequential('Property default languages (real PostgreSQL)', () => {
  it('reads as English until someone chooses', async () => {
    const experience = await repository().getPropertyExperience(ORG_A, PROPERTY)
    expect(experience.profile?.defaultGuestLocales).toEqual(['en'])
  })

  it('saves the ordered set and moves no version, no fence, no event, and not who saved', async () => {
    const before = await profileRow()

    const saved = await repository().saveDefaultGuestLocales({
      organizationId: ORG_A,
      propertyId: PROPERTY,
      locales: ['bg', 'en'],
    })

    expect(saved).toMatchObject({
      defaultGuestLocales: ['bg', 'en'],
      version: 5,
      lookVersion: 3,
      updatedBy: ADMIN,
    })
    const after = await profileRow()
    expect(after).toMatchObject({
      default_guest_locales: ['bg', 'en'],
      version: before.version,
      look_version: before.look_version,
      updated_by: before.updated_by,
    })
    await expect(pendingRows()).resolves.toEqual([])
    await expect(brandEventCount()).resolves.toBe(0)
  })

  it('leaves the public display name unconfirmed when a name was filled in automatically', async () => {
    await query(
      `UPDATE property_portal_brand_profiles SET updated_by = 'system:public-display-name-default'
       WHERE organization_id = $1`,
      [ORG_A],
    )
    await repository().saveDefaultGuestLocales({
      organizationId: ORG_A,
      propertyId: PROPERTY,
      locales: ['bg'],
    })
    await expect(profileRow()).resolves.toMatchObject({
      updated_by: 'system:public-display-name-default',
    })
  })

  it('answers null for a Property with no profile, and for another organisation', async () => {
    await expect(
      repository().saveDefaultGuestLocales({
        organizationId: ORG_A,
        propertyId: OTHER_PROPERTY,
        locales: ['bg'],
      }),
    ).resolves.toBeNull()
    await expect(
      repository().saveDefaultGuestLocales({
        organizationId: ORG_B,
        propertyId: PROPERTY,
        locales: ['bg'],
      }),
    ).resolves.toBeNull()
    await expect(profileRow()).resolves.toMatchObject({ default_guest_locales: ['en'] })
  })
})

describe.sequential('Property hero alt text (real PostgreSQL)', () => {
  const saveContent = (heroAltText?: string | null, title = 'Welcome', at = LATER) =>
    repository().savePropertyContent({
      id: randomUUID(),
      organizationId: ORG_A,
      propertyId: PROPERTY,
      locale: 'en',
      content: {
        title,
        shortDescription: 'Tell us how it went.',
        ...(heroAltText === undefined ? {} : { heroAltText }),
      },
      updatedBy: ADMIN,
      at,
    })

  it('stores the alt text with the content, versions the row and fences each published Portal', async () => {
    const created = await saveContent('The harbour at dusk')
    expect(created).toMatchObject({ heroAltText: 'The harbour at dusk', version: 1 })

    const updated = await saveContent('Boats in the harbour', 'Welcome', LATEST)
    expect(updated).toMatchObject({ heroAltText: 'Boats in the harbour', version: 2 })

    const rows = await pendingRows()
    expect(
      rows.map((row) => [row.change_kind, row.change_key, row.source_version]),
    ).toEqual([
      ['property_brand_content', 'en', 'v1'],
      ['property_brand_content', 'en', 'v2'],
      ['property_brand_content', 'en', 'v1'],
      ['property_brand_content', 'en', 'v2'],
    ])
  })

  it('keeps the alt text when a save does not mention it, and clears it when given null', async () => {
    await saveContent('The harbour at dusk')
    await expect(saveContent(undefined, 'Hello', LATEST)).resolves.toMatchObject({
      heroAltText: 'The harbour at dusk',
      title: 'Hello',
    })
    await expect(saveContent(null, 'Hello', LATEST)).resolves.toMatchObject({
      heroAltText: null,
    })
  })

  it('reads it back with the Property experience, without an alt text for other locales', async () => {
    await saveContent('The harbour at dusk')
    const { content } = await repository().getPropertyExperience(ORG_A, PROPERTY)
    expect(content.map((row) => [row.locale, row.heroAltText])).toEqual([
      ['en', 'The harbour at dusk'],
    ])
  })
})
