// A Portal's own look saved against PostgreSQL (ADR 0070): what one save of a
// group writes, which version it lands at, and what it records. A save that
// moves nothing guests see (taking the Property's colours over as they are)
// writes the row and nothing else; one that does moves the Portal's effective
// look version by one and records each moved facet as a page edit of this
// Portal alone, fencing it only when it has been published. The saves through
// the use cases pin who may save and which images a Portal may point at.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { getDb } from '#/shared/db'
import {
  organizationId,
  portalId,
  portalMediaAssetId,
  propertyId,
  userId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { isPortalError } from '../../domain/errors'
import type { PortalLookChange } from '../../domain/portal-look'
import type { SavePortalLookPartInput } from '../../application/ports/portal-look.repository'
import {
  savePortalLookColours,
  savePortalLookIdentity,
} from '../../application/use-cases/save-portal-look'
import { savePortalLookPhoto } from '../../application/use-cases/save-portal-photo'
import { createPortalLookRepository } from './portal-look.repository'
import { createPortalMediaAssetRepository } from './portal-media-asset.repository'
import { createPortalRepository } from './portal.repository'

const ORG_A = organizationId('org-portal-look-writes-00000000001')
const ORG_B = organizationId('org-portal-look-writes-00000000002')
const PROPERTY = propertyId('7f100000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('7f100000-0000-4000-8000-000000000002')
const PROPERTY_B = propertyId('7f100000-0000-4000-8000-000000000003')
const SPA = portalId('7f200000-0000-4000-8000-000000000001')
const RECEPTION = portalId('7f200000-0000-4000-8000-000000000002')
const BAR = portalId('7f200000-0000-4000-8000-000000000003')
const GONE = portalId('7f200000-0000-4000-8000-000000000004')
const QUAY = portalId('7f200000-0000-4000-8000-000000000005')
const OLD_BAR = portalId('7f200000-0000-4000-8000-000000000006')
const PORTAL_B = portalId('7f200000-0000-4000-8000-000000000007')
const PROPERTY_HERO = '7f300000-0000-4000-8000-000000000001'
const PROPERTY_LOGO = '7f300000-0000-4000-8000-000000000002'
const OWN_HERO = '7f300000-0000-4000-8000-000000000003'
const OWN_LOGO = '7f300000-0000-4000-8000-000000000004'
const OTHER_PROPERTY_HERO = '7f300000-0000-4000-8000-000000000005'
const TAKEN_DOWN_HERO = '7f300000-0000-4000-8000-000000000006'
const ADMIN = userId('admin-portal-look-writes-00000001')
const NOW = new Date('2026-10-26T10:00:00.000Z')
const SOON = new Date('2026-10-26T10:01:00.000Z')
const LATER = new Date('2026-10-26T11:00:00.000Z')
const ACCENT = '#2F855A'

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

const repository = () => createPortalLookRepository(getDb())

async function seedProperty(org: OrganizationId, id: PropertyId, slug: string) {
  await query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'UTC', $4, $4)`,
    [id, org, slug, NOW],
  )
}

type PortalSeed = Readonly<{
  org?: OrganizationId
  property?: PropertyId
  published?: boolean
  state?: string
  deletedAt?: Date
  additional?: readonly string[]
}>

async function seedPortal(id: PortalId, slug: string, seed: PortalSeed = {}) {
  const org = seed.org ?? ORG_A
  const property = seed.property ?? PROPERTY
  await query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name,
                          slug, theme, publication_state, primary_guest_locale,
                          additional_guest_locales, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, 'property', $4, $5, $5, '{"primaryColor":"#6366F1"}'::jsonb, $6,
             'en', $7::jsonb, $8, $8, $9)`,
    [
      id,
      org,
      property,
      String(property),
      slug,
      seed.state ?? 'draft',
      JSON.stringify(seed.additional ?? []),
      NOW,
      seed.deletedAt ?? null,
    ],
  )
  if (!seed.published) return
  await query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', $6, 0, 1, $7, $6)`,
    [randomUUID(), org, property, id, 'b'.repeat(64), NOW, ADMIN],
  )
}

async function seedMedia() {
  const media = createPortalMediaAssetRepository(getDb())
  const asset = (
    id: string,
    patch: Parameters<typeof buildTestPortalMediaAsset>[0] = {},
  ) =>
    buildTestPortalMediaAsset({
      id: portalMediaAssetId(id),
      organizationId: ORG_A,
      propertyId: PROPERTY,
      ...patch,
    })
  for (const row of [
    asset(PROPERTY_HERO),
    asset(PROPERTY_LOGO, { purpose: 'logo' }),
    asset(OWN_HERO),
    asset(OWN_LOGO, { purpose: 'logo' }),
    asset(OTHER_PROPERTY_HERO, { propertyId: OTHER_PROPERTY }),
    asset(TAKEN_DOWN_HERO, { status: 'taken_down', takenDownAt: NOW }),
  ]) {
    await media.insert(row)
  }
}

beforeEach(async () => {
  await seedProperty(ORG_A, PROPERTY, 'avela-resort')
  await seedProperty(ORG_A, OTHER_PROPERTY, 'quay-house')
  await seedProperty(ORG_B, PROPERTY_B, 'other-tenant')
  await seedPortal(SPA, 'spa', { published: true, additional: ['bg'] })
  await seedPortal(RECEPTION, 'reception', { published: true })
  await seedPortal(BAR, 'bar')
  await seedPortal(GONE, 'gone', { deletedAt: NOW })
  await seedPortal(OLD_BAR, 'old-bar', { state: 'archived' })
  await seedPortal(QUAY, 'quay', { property: OTHER_PROPERTY })
  await seedPortal(PORTAL_B, 'spa', { org: ORG_B, property: PROPERTY_B })
  await seedMedia()
  await query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, primary_color, background_color,
        text_color, background_mode, wordmark, hero_asset_id, hero_focal_x, hero_focal_y,
        logo_asset_id, version, look_version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Avela Resort', '#B8860B', '#1A1A1A', '#F5F1E8', 'auto', 'AVELA',
             $4, 0.3, 0.7, $5, 5, 3, $6, $7, $7)`,
    [randomUUID(), ORG_A, PROPERTY, PROPERTY_HERO, PROPERTY_LOGO, ADMIN, NOW],
  )
  await query(
    `INSERT INTO property_portal_brand_contents
       (id, organization_id, property_id, locale, title, short_description, hero_alt_text,
        version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'en', 'Welcome', 'Tell us', 'The pool at dusk', 1, $4, $5, $5),
            ($6, $2, $3, 'bg', 'Добре дошли', 'Кажете ни', 'Басейнът', 1, $4, $5, $5)`,
    [randomUUID(), ORG_A, PROPERTY, ADMIN, NOW, randomUUID()],
  )
})

const save = (
  change: PortalLookChange,
  target: Partial<Pick<SavePortalLookPartInput, 'organizationId' | 'propertyId'>> &
    Readonly<{ portalId?: PortalId; at?: Date }> = {},
) =>
  repository().savePortalLookPart({
    organizationId: target.organizationId ?? ORG_A,
    propertyId: target.propertyId ?? PROPERTY,
    portalId: target.portalId ?? SPA,
    change,
    actorUserId: ADMIN,
    at: target.at ?? NOW,
  })

async function overrideRow(portal: PortalId = SPA, org: OrganizationId = ORG_A) {
  const { rows } = await query(
    `SELECT photo_mode, hero_asset_id::text AS hero_asset_id, hero_focal_x, hero_focal_y,
            hero_alt_texts, colours_mode, primary_color, background_mode, background_color,
            identity_mode, wordmark, logo_asset_id::text AS logo_asset_id, look_version,
            updated_by, updated_at
     FROM portal_look_overrides WHERE organization_id = $1 AND portal_id = $2`,
    [org, portal],
  )
  return rows[0]
}

async function pendingRows() {
  const { rows } = await query(
    `SELECT portal_id::text AS portal_id, change_kind, change_key, source_version
     FROM portal_pending_content_changes WHERE organization_id = $1
     ORDER BY portal_id, change_key, source_version`,
    [ORG_A],
  )
  return rows
}

async function pageEditRows() {
  const { rows } = await query(
    `SELECT portal_id::text AS portal_id, change_kind, change_key, edit_count, actor_user_id
     FROM portal_page_edits WHERE organization_id = $1
     ORDER BY occurred_at, change_key`,
    [ORG_A],
  )
  return rows
}

describe.sequential('savePortalLookPart (real PostgreSQL)', () => {
  it('takes the Property’s colours over with no version, page edit or pending change', async () => {
    const saved = await save({ group: 'colours', mode: 'own' })

    expect(saved).toMatchObject({
      status: 'saved',
      changedFacets: [],
      override: { colours: { mode: 'own', accent: '#B8860B' }, lookVersion: 3 },
    })
    await expect(overrideRow()).resolves.toMatchObject({
      colours_mode: 'own',
      primary_color: '#B8860B',
      background_mode: 'auto',
      background_color: '#1A1A1A',
      photo_mode: 'inherit',
      identity_mode: 'inherit',
      // The Portal already publishes the Property's version: nothing it shows moved.
      look_version: 3,
      updated_by: ADMIN,
    })
    await expect(pendingRows()).resolves.toEqual([])
    await expect(pageEditRows()).resolves.toEqual([])
  })

  it('moves the version once and records what moved, for this Portal alone', async () => {
    const saved = await save({ group: 'colours', mode: 'own', accent: ACCENT })

    expect(saved).toMatchObject({
      status: 'saved',
      changedFacets: ['accent'],
      override: { lookVersion: 4 },
    })
    await expect(overrideRow()).resolves.toMatchObject({
      primary_color: ACCENT,
      look_version: 4,
    })
    await expect(pageEditRows()).resolves.toEqual([
      {
        portal_id: SPA,
        change_kind: 'portal_configuration',
        change_key: 'look:accent',
        edit_count: 1,
        actor_user_id: ADMIN,
      },
    ])
    await expect(pendingRows()).resolves.toEqual([
      {
        portal_id: SPA,
        change_kind: 'portal_configuration',
        change_key: 'look:accent',
        source_version: 'look:v4',
      },
    ])
  })

  it('folds one person’s autosaves into one page edit, fencing each version', async () => {
    await save({ group: 'colours', mode: 'own', accent: ACCENT })
    await save({ group: 'colours', mode: 'own', accent: '#276749' }, { at: SOON })

    await expect(overrideRow()).resolves.toMatchObject({ look_version: 5 })
    const edits = await pageEditRows()
    expect(edits).toEqual([expect.objectContaining({ edit_count: 2 })])
    expect((await pendingRows()).map((row) => row.source_version)).toEqual([
      'look:v4',
      'look:v5',
    ])
  })

  it('records a draft Portal’s edit and opens no fence for it', async () => {
    await save({ group: 'identity', mode: 'own', wordmark: 'BAR' }, { portalId: BAR })

    await expect(pageEditRows()).resolves.toEqual([
      expect.objectContaining({
        portal_id: BAR,
        change_kind: 'portal_configuration',
        change_key: 'look:wordmark',
      }),
    ])
    await expect(pendingRows()).resolves.toEqual([])
  })

  it('puts a group back to the Property’s, holding no values, at the next version', async () => {
    await save({ group: 'colours', mode: 'own', accent: ACCENT })
    const saved = await save({ group: 'colours', mode: 'inherit' }, { at: LATER })

    expect(saved).toMatchObject({
      changedFacets: ['accent'],
      override: { lookVersion: 5 },
    })
    await expect(overrideRow()).resolves.toMatchObject({
      colours_mode: 'inherit',
      primary_color: null,
      background_mode: null,
      background_color: null,
      look_version: 5,
    })
  })

  it('needs no row to follow what a Portal already follows', async () => {
    const saved = await save({ group: 'photo', mode: 'inherit' })

    expect(saved).toMatchObject({ status: 'saved', changedFacets: [] })
    await expect(overrideRow()).resolves.toBeUndefined()
    await expect(pageEditRows()).resolves.toEqual([])
  })

  it('takes the Property’s photo over with its anchor and its descriptions in the Portal’s languages', async () => {
    // Reception is in English only: the Bulgarian description stays the Property's.
    const saved = await save({ group: 'photo', mode: 'own' }, { portalId: RECEPTION })

    expect(saved).toMatchObject({ changedFacets: [] })
    await expect(overrideRow(RECEPTION)).resolves.toMatchObject({
      photo_mode: 'own',
      hero_asset_id: PROPERTY_HERO,
      hero_focal_x: 0.3,
      hero_focal_y: 0.7,
      hero_alt_texts: { en: 'The pool at dusk' },
      look_version: 3,
    })
  })

  it('centres a new photo, describes it by nothing until told, and can show no photo', async () => {
    const own = await save({ group: 'photo', mode: 'own', heroAssetId: OWN_HERO })
    expect(own).toMatchObject({ changedFacets: ['photo'] })
    await expect(overrideRow()).resolves.toMatchObject({
      hero_asset_id: OWN_HERO,
      hero_focal_x: 0.5,
      hero_focal_y: 0.5,
      hero_alt_texts: {},
      look_version: 4,
    })

    const described = await save(
      { group: 'photo', mode: 'own', altTexts: { bg: 'Стая за масаж' } },
      { at: SOON },
    )
    expect(described).toMatchObject({ changedFacets: ['photo'] })
    await expect(overrideRow()).resolves.toMatchObject({
      hero_alt_texts: { bg: 'Стая за масаж' },
      look_version: 5,
    })

    await save({ group: 'photo', mode: 'none' }, { at: LATER })
    await expect(overrideRow()).resolves.toMatchObject({
      photo_mode: 'none',
      hero_asset_id: null,
      hero_focal_x: null,
      hero_alt_texts: {},
      look_version: 6,
    })
  })

  it('answers brand_profile_missing for a Property with no Brand Profile, and writes nothing', async () => {
    await expect(
      save(
        { group: 'colours', mode: 'own' },
        { propertyId: OTHER_PROPERTY, portalId: QUAY },
      ),
    ).resolves.toEqual({ status: 'brand_profile_missing' })
    await expect(overrideRow(QUAY)).resolves.toBeUndefined()
  })

  it('answers portal_not_found for a deleted Portal, another Property’s, another tenant’s', async () => {
    const change: PortalLookChange = { group: 'colours', mode: 'own', accent: ACCENT }

    await expect(save(change, { portalId: GONE })).resolves.toEqual({
      status: 'portal_not_found',
    })
    await expect(save(change, { propertyId: OTHER_PROPERTY })).resolves.toEqual({
      status: 'portal_not_found',
    })
    await expect(save(change, { organizationId: ORG_B })).resolves.toEqual({
      status: 'portal_not_found',
    })
    await expect(overrideRow()).resolves.toBeUndefined()
    await expect(pageEditRows()).resolves.toEqual([])
  })

  it('leaves another tenant’s row alone', async () => {
    await query(
      `INSERT INTO portal_look_overrides (organization_id, property_id, portal_id,
                                          photo_mode, look_version, updated_by)
       VALUES ($1, $2, $3, 'none', 2, 'someone-else')`,
      [ORG_B, PROPERTY_B, PORTAL_B],
    )

    await save({ group: 'colours', mode: 'own', accent: ACCENT })

    await expect(overrideRow(PORTAL_B, ORG_B)).resolves.toMatchObject({
      photo_mode: 'none',
      look_version: 2,
      updated_by: 'someone-else',
    })
  })

  it('holds an image of another Property off at the database, rolling the save back', async () => {
    await expect(
      save({ group: 'photo', mode: 'own', heroAssetId: OTHER_PROPERTY_HERO }),
    ).rejects.toThrow()
    await expect(overrideRow()).resolves.toBeUndefined()
    await expect(pageEditRows()).resolves.toEqual([])
    await expect(pendingRows()).resolves.toEqual([])
  })
})

describe.sequential('a Portal’s own look through its use cases (real PostgreSQL)', () => {
  const ADMIN_CTX = buildTestAuthContext({
    organizationId: ORG_A,
    userId: ADMIN,
    role: 'AccountAdmin',
  })
  const MANAGER_CTX = buildTestAuthContext({
    organizationId: ORG_A,
    role: 'PropertyManager',
  })
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  }
  const depsOf = (portalOwnLookEnabled = true) => ({
    portalRepo: createPortalRepository(getDb()),
    portalLookRepo: repository(),
    mediaRepo: createPortalMediaAssetRepository(getDb()),
    staffPublicApi,
    clock: () => NOW,
    portalOwnLookEnabled,
  })
  const target = { propertyId: String(PROPERTY), portalId: String(SPA) }
  const failsWith = (code: string) => (error: unknown) =>
    isPortalError(error) && error.code === code

  it('saves an Account Admin’s own photo, logo and colours', async () => {
    const deps = depsOf()
    await savePortalLookPhoto(deps)(
      { ...target, photo: { mode: 'own', heroAssetId: OWN_HERO, focalX: 0.2 } },
      ADMIN_CTX,
    )
    await savePortalLookIdentity(deps)(
      { ...target, identity: { mode: 'own', logoAssetId: OWN_LOGO } },
      ADMIN_CTX,
    )
    const saved = await savePortalLookColours(deps)(
      { ...target, colours: { mode: 'own', accentColour: '#2f855a' } },
      ADMIN_CTX,
    )

    expect(saved).toEqual({
      portalId: SPA,
      sources: { photo: 'portal', colours: 'portal', identity: 'portal' },
      lookVersion: 6,
      changed: true,
    })
    await expect(overrideRow()).resolves.toMatchObject({
      hero_asset_id: OWN_HERO,
      hero_focal_x: 0.2,
      hero_focal_y: 0.5,
      logo_asset_id: OWN_LOGO,
      wordmark: 'AVELA',
      primary_color: ACCENT,
    })
  })

  it.each([
    ['a logo', PROPERTY_LOGO],
    ['a photo of another Property', OTHER_PROPERTY_HERO],
    ['a photo that was taken down', TAKEN_DOWN_HERO],
    ['an image of nobody', '7f300000-0000-4000-8000-0000000000ff'],
  ])('refuses %s as the photo, as an image not found', async (_, heroAssetId) => {
    await expect(
      savePortalLookPhoto(depsOf())(
        { ...target, photo: { mode: 'own', heroAssetId } },
        ADMIN_CTX,
      ),
    ).rejects.toSatisfy(failsWith('media_not_found'))
    await expect(overrideRow()).resolves.toBeUndefined()
  })

  it('refuses a photo as the logo', async () => {
    await expect(
      savePortalLookIdentity(depsOf())(
        { ...target, identity: { mode: 'own', logoAssetId: OWN_HERO } },
        ADMIN_CTX,
      ),
    ).rejects.toSatisfy(failsWith('media_not_found'))
  })

  it('lets only an Account Admin save, never on an archived Portal, and not while switched off', async () => {
    const own = { ...target, colours: { mode: 'own' as const, accentColour: ACCENT } }

    await expect(savePortalLookColours(depsOf())(own, MANAGER_CTX)).rejects.toSatisfy(
      failsWith('forbidden'),
    )
    await expect(
      savePortalLookColours(depsOf())({ ...own, portalId: String(OLD_BAR) }, ADMIN_CTX),
    ).rejects.toSatisfy(failsWith('portal_inactive'))
    await expect(savePortalLookColours(depsOf(false))(own, ADMIN_CTX)).rejects.toSatisfy(
      failsWith('feature_unavailable'),
    )
    await expect(overrideRow()).resolves.toBeUndefined()
    await expect(overrideRow(OLD_BAR)).resolves.toBeUndefined()
    await expect(pageEditRows()).resolves.toEqual([])
  })
})
