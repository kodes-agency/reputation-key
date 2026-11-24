// The Property look: what a look edit, a name edit and a default-language edit
// each move. `version` is what AI reply drafts fence on, so it moves only with
// the public display name; `look_version` moves with the look; default
// languages only seed new Portals and so move nothing and notify no Portal.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createPortalAiReplyBrandProfileAuthority } from '../look/ai-reply-brand-profile-authority.server'
import { createPortalExperienceRepository } from './portal-experience-repository.server'

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

type LookInput = Parameters<
  ReturnType<typeof createPortalExperienceRepository>['savePropertyLook']
>[0]['look']

const baseLook: LookInput = {
  primaryColor: '#2563EB',
  backgroundMode: 'auto',
}

const saveLook = (look: Partial<LookInput>, by = ADMIN, at = LATER) =>
  repository().savePropertyLook({
    organizationId: ORG_A,
    propertyId: PROPERTY,
    look: { ...baseLook, ...look },
    actorUserId: by,
    at,
  })

const saveName = (displayName: string, by = ADMIN, at = LATER) =>
  repository().savePropertyDisplayName({
    id: randomUUID(),
    organizationId: ORG_A,
    propertyId: PROPERTY,
    displayName,
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

/** The page-edit ledger of the organisation: Property-wide rows have no Portal. */
async function pageEditRows() {
  const { rows } = await query(
    `SELECT portal_id::text AS portal_id, change_kind, change_key, actor_user_id
     FROM portal_page_edits WHERE organization_id = $1
     ORDER BY occurred_at, change_kind, change_key`,
    [ORG_A],
  )
  return rows as ReadonlyArray<{
    portal_id: string | null
    change_kind: string
    change_key: string
    actor_user_id: string | null
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
    const saved = await saveLook({
      primaryColor: '#C8A45A',
      backgroundColor: '#14110F',
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

    await saveLook({ primaryColor: '#C8A45A', wordmark: 'HARBOUR' })
    await expect(isCurrent()).resolves.toBe(true)
    await expect(
      authority.readCurrentAiReplyBrandProfile(ORG_A, PROPERTY),
    ).resolves.toEqual(before)

    await saveName('Harbour House Hotel')
    await expect(isCurrent()).resolves.toBe(false)
  })

  it('records one look row per facet for each Portal that has been published, and none for a draft', async () => {
    await saveLook({ primaryColor: '#C8A45A', wordmark: 'HARBOUR' })

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

  it('writes one Property-wide ledger row per facet changed, naming who and never a Portal', async () => {
    await saveLook({ primaryColor: '#C8A45A', wordmark: 'HARBOUR' }, SECOND_ADMIN)

    expect(await pageEditRows()).toEqual([
      {
        portal_id: null,
        change_kind: 'property_brand_profile',
        change_key: 'look:accent',
        actor_user_id: SECOND_ADMIN,
      },
      {
        portal_id: null,
        change_kind: 'property_brand_profile',
        change_key: 'look:wordmark',
        actor_user_id: SECOND_ADMIN,
      },
    ])
  })

  it('writes the name edit as the general profile row, and nothing for a save that changes nothing', async () => {
    await saveLook({}, SECOND_ADMIN)
    expect(await pageEditRows()).toEqual([])

    await saveName('Harbour House Hotel')
    expect(await pageEditRows()).toEqual([
      {
        portal_id: null,
        change_kind: 'property_brand_profile',
        change_key: 'all',
        actor_user_id: ADMIN,
      },
    ])
  })

  it('attributes a name saved on its own to the person, and an automatic first name to the system', async () => {
    await repository().savePropertyDisplayName({
      id: randomUUID(),
      organizationId: ORG_A,
      propertyId: PROPERTY,
      displayName: 'Harbour Hotel',
      updatedBy: SECOND_ADMIN,
      at: LATER,
    })
    await repository().ensurePropertyDisplayName({
      id: randomUUID(),
      organizationId: ORG_A,
      propertyId: OTHER_PROPERTY,
      displayName: 'Quay House',
      at: LATEST,
    })

    expect(await pageEditRows()).toEqual([
      {
        portal_id: null,
        change_kind: 'property_brand_profile',
        change_key: 'all',
        actor_user_id: SECOND_ADMIN,
      },
      {
        portal_id: null,
        change_kind: 'property_brand_profile',
        change_key: 'all',
        actor_user_id: null,
      },
    ])
  })

  it('names the field facet for a background mode or colour change', async () => {
    await saveLook({ backgroundMode: 'manual', backgroundColor: '#000000' })
    const keys = (await pendingRows()).map((row) => row.change_key)
    expect(new Set(keys)).toEqual(new Set(['look:field']))
  })

  it('records the name fence, and no look row, when only the name changes', async () => {
    const saved = await saveName('Harbour House Hotel')

    expect(saved).toMatchObject({ version: 6, lookVersion: 3 })
    const rows = await pendingRows()
    expect(rows.map((row) => [row.change_key, row.source_version])).toEqual([
      ['all', 'v6'],
      ['all', 'v6'],
    ])
    await expect(brandEventCount()).resolves.toBe(1)
  })

  it('records both fences when the name and the look change one after the other', async () => {
    await saveName('Harbour')
    const saved = await saveLook({ primaryColor: '#C8A45A' })

    expect(saved).toMatchObject({ version: 6, lookVersion: 4 })
    const keys = (await pendingRows()).map((row) => [row.change_key, row.source_version])
    expect(keys).toContainEqual(['all', 'v6'])
    expect(keys).toContainEqual(['look:accent', 'v4'])
    expect(keys).toHaveLength(4)
  })

  it('announces a look edit with the unchanged profile version', async () => {
    await saveLook({ primaryColor: '#C8A45A' })
    const { rows } = await query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'portal.property_brand_profile.updated'`,
      [ORG_A],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ profileVersion: 5 })
  })

  it('treats a name saved as it was as a confirmation: who, no versions, no fences, no event', async () => {
    const saved = await saveName('Harbour House', SECOND_ADMIN)

    expect(saved).toMatchObject({ version: 5, lookVersion: 3, updatedBy: SECOND_ADMIN })
    await expect(profileRow()).resolves.toMatchObject({
      version: 5,
      look_version: 3,
      updated_by: SECOND_ADMIN,
    })
    await expect(pendingRows()).resolves.toEqual([])
    await expect(brandEventCount()).resolves.toBe(0)
  })

  it('keeps the wordmark a caller does not mention, and clears one given as null', async () => {
    await saveLook({ wordmark: 'HARBOUR', backgroundMode: 'manual' })
    await saveLook({ primaryColor: '#C8A45A', backgroundMode: 'manual' }, ADMIN, LATEST)
    await expect(profileRow()).resolves.toMatchObject({
      wordmark: 'HARBOUR',
      background_mode: 'manual',
      look_version: 5,
    })

    await saveLook({ wordmark: null, backgroundMode: 'manual' }, ADMIN, LATEST)
    await expect(profileRow()).resolves.toMatchObject({ wordmark: null, look_version: 6 })
  })

  it('never touches the default languages when the look or the name is saved', async () => {
    await query(
      `UPDATE property_portal_brand_profiles SET default_guest_locales = '["bg","en"]'::jsonb
       WHERE organization_id = $1`,
      [ORG_A],
    )
    await saveLook({ primaryColor: '#C8A45A' })
    await saveName('Harbour')
    await expect(profileRow()).resolves.toMatchObject({
      default_guest_locales: ['bg', 'en'],
    })
  })

  it('creates a first profile at version 1 and look version 1, automatic background, English', async () => {
    const created = await repository().savePropertyDisplayName({
      id: randomUUID(),
      organizationId: ORG_A,
      propertyId: OTHER_PROPERTY,
      displayName: 'Quay House',
      updatedBy: ADMIN,
      at: NOW,
    })

    expect(created).toMatchObject({
      version: 1,
      lookVersion: 1,
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
    // One ledger row per save for the whole Property, not one per Portal.
    expect(await pageEditRows()).toEqual([
      {
        portal_id: null,
        change_kind: 'property_brand_content',
        change_key: 'en',
        actor_user_id: ADMIN,
      },
      {
        portal_id: null,
        change_kind: 'property_brand_content',
        change_key: 'en',
        actor_user_id: ADMIN,
      },
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
