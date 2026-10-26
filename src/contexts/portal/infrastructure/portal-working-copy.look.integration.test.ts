// A Portal's own look (ADR 0070) in the working copy, against real PostgreSQL.
//
// The reader lays the Portal's `portal_look_overrides` row over its Property's
// look before it looks any image up, so publish, the in-transaction verification,
// History and Review all see the Portal's own look. These tests seed the rows by
// SQL (the writers are built beside this slice) and pin what the working copy is
// for each combination of groups, that a Portal with no row reads exactly as it
// did before Portals could have a look, and that a look moving between the read
// and the commit stops the commit.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { PROPERTY_LOOK_SOURCES } from '../domain/portal-look'
import {
  brandProfileOf,
  resolvePortalPublication,
  type PortalPublicationSource,
} from '../domain/portal-publication-source'
import {
  readPortalWorkingCopy,
  readPortalWorkingCopyWithLook,
} from './portal-working-copy.reader'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import {
  seedPortalLookOverride,
  seedPortalWorkingCopy,
  seedSiblingPortal,
} from './testing/portal-working-copy-seed'
import {
  publishFromSource,
  workingCopyDiffersFromLive,
} from './testing/portal-working-copy-publish'
import {
  COMPLETE_SCENARIO,
  NO_BRAND_SCENARIO,
  NO_PHOTO_LOOK,
  OWN_COLOURS_LOOK,
  OWN_EVERYTHING_LOOK,
  OWN_IDENTITY_LOOK,
  OWN_PHOTO_LOOK,
  OWN_PHOTO_WITHOUT_ALT_LOOK,
  SCENARIO_HERO_ASSET,
  SCENARIO_OWN_HERO_ASSET,
  SCENARIO_OWN_LOGO_ASSET,
  SCENARIO_TILE_ASSET,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
  withOwnLook,
  type WorkingCopyScenario,
} from './testing/portal-working-copy-scenarios'
import {
  COMPLETE_GOLDEN,
  NO_BRAND_GOLDEN,
  NO_PHOTO_GOLDEN,
  OWN_COLOURS_GOLDEN,
  OWN_EVERYTHING_GOLDEN,
  OWN_IDENTITY_GOLDEN,
  OWN_PHOTO_GOLDEN,
  OWN_PHOTO_WITHOUT_ALT_GOLDEN,
} from './__fixtures__/portal-working-copy.golden'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_localized_overrides',
    'portal_look_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const SIBLING_PORTAL = 'c2000000-0000-4000-8000-0000000000a1'

const scopeOf = (scenario: WorkingCopyScenario) => ({
  organizationId: scenario.organizationId,
  propertyId: scenario.propertyId,
  portalId: scenario.portalId,
})

/** The working copy as publish reads it: through the publication repository. */
const publishRead = (scenario: WorkingCopyScenario) =>
  createPortalPublicationRepository(getDb()).loadWorkingCopy(
    scenario.organizationId,
    scenario.portalId,
  )

const readWithLook = (scenario: WorkingCopyScenario) =>
  readPortalWorkingCopyWithLook(getDb(), scopeOf(scenario))

async function sourceOf(scenario: WorkingCopyScenario): Promise<PortalPublicationSource> {
  const source = await publishRead(scenario)
  if (!source) throw new Error('the scenario has no working copy')
  return source
}

describe.sequential("a Portal's own look in the working copy (real PostgreSQL)", () => {
  it.each([
    ['its own photo, described in its own words', OWN_PHOTO_LOOK, OWN_PHOTO_GOLDEN],
    [
      'its own photo that nobody described',
      OWN_PHOTO_WITHOUT_ALT_LOOK,
      OWN_PHOTO_WITHOUT_ALT_GOLDEN,
    ],
    ['no photo at all', NO_PHOTO_LOOK, NO_PHOTO_GOLDEN],
    ['its own colours', OWN_COLOURS_LOOK, OWN_COLOURS_GOLDEN],
    ['its own name and logo', OWN_IDENTITY_LOOK, OWN_IDENTITY_GOLDEN],
    ['all three groups of its own', OWN_EVERYTHING_LOOK, OWN_EVERYTHING_GOLDEN],
  ])('reads a Portal with %s exactly as pinned', async (_name, look, golden) => {
    const scenario = withOwnLook(look)
    await seedPortalWorkingCopy(getPool(), scenario)

    await expect(publishRead(scenario)).resolves.toEqual(golden)
  })

  it('reads the same working copy inside a transaction as outside it', async () => {
    const scenario = withOwnLook(OWN_EVERYTHING_LOOK)
    await seedPortalWorkingCopy(getPool(), scenario)

    const inTransaction = await getDb().transaction((tx) =>
      readPortalWorkingCopy(tx, scopeOf(scenario)),
    )

    expect(inTransaction).toEqual(OWN_EVERYTHING_GOLDEN)
    await expect(publishRead(scenario)).resolves.toEqual(inTransaction)
  })

  it('reports where each group of the look comes from beside the source', async () => {
    await seedPortalWorkingCopy(getPool(), withOwnLook(OWN_PHOTO_LOOK))
    await expect(readWithLook(COMPLETE_SCENARIO)).resolves.toMatchObject({
      lookSources: { photo: 'portal', colours: 'property', identity: 'property' },
    })
    await getPool().query(`UPDATE portal_look_overrides SET photo_mode = 'inherit',
      hero_asset_id = NULL, hero_focal_x = NULL, hero_focal_y = NULL,
      hero_alt_texts = '{}'::jsonb, colours_mode = 'own', primary_color = '#B8860B',
      background_mode = 'auto', background_color = '#201810',
      identity_mode = 'own', look_version = 6`)
    await expect(readWithLook(COMPLETE_SCENARIO)).resolves.toMatchObject({
      lookSources: { photo: 'property', colours: 'portal', identity: 'portal' },
    })
    await getPool().query(`UPDATE portal_look_overrides SET photo_mode = 'none'`)
    await expect(readWithLook(COMPLETE_SCENARIO)).resolves.toMatchObject({
      lookSources: { photo: 'none', colours: 'portal', identity: 'portal' },
    })
  })

  describe('a Portal with no look of its own', () => {
    it('follows every group and reads exactly as pinned before Portals could have one', async () => {
      await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)

      await expect(readWithLook(COMPLETE_SCENARIO)).resolves.toEqual({
        source: COMPLETE_GOLDEN,
        lookSources: PROPERTY_LOOK_SOURCES,
      })
    })

    it('is not changed by the look of another Portal of the same Property', async () => {
      // The Property has the images the sibling takes as its own; this Portal has no row.
      const scenario: WorkingCopyScenario = {
        ...COMPLETE_SCENARIO,
        mediaAssets: withOwnLook(OWN_EVERYTHING_LOOK).mediaAssets,
      }
      await seedPortalWorkingCopy(getPool(), scenario)
      const before = await sourceOf(scenario)
      await seedSiblingPortal(getPool(), scenario, {
        portalId: SIBLING_PORTAL,
        slug: 'spa',
      })
      await seedPortalLookOverride(
        getPool(),
        { ...scopeOf(scenario), portalId: SIBLING_PORTAL },
        OWN_EVERYTHING_LOOK,
      )

      const after = await sourceOf(scenario)

      expect(after).toEqual(before)
      expect(after).toEqual(COMPLETE_GOLDEN)
    })

    it('keeps a stored background colour exactly as stored, in lowercase', async () => {
      const scenario: WorkingCopyScenario = {
        ...COMPLETE_SCENARIO,
        brand: { ...COMPLETE_SCENARIO.brand!, backgroundColor: '#abcdef' },
      }
      await seedPortalWorkingCopy(getPool(), scenario)

      const source = await sourceOf(scenario)

      expect(source.look?.backgroundColour).toBe('#abcdef')
      expect(brandProfileOf(source).fieldColour).toBe('#abcdef')
    })

    it('publishes the Property’s look and version, as it always did', async () => {
      await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
      const source = await sourceOf(COMPLETE_SCENARIO)

      const { brandProfile, localizedContent } = resolvePortalPublication(source).content

      expect(brandProfile).toMatchObject({
        displayName: 'Hotel Rila',
        wordmark: 'RILA',
        accentColour: '#1D4ED8',
        fieldColour: '#101820',
        lookVersion: 4,
        hero: { assetId: SCENARIO_HERO_ASSET, focalX: 0.3, focalY: 0.7 },
      })
      expect(localizedContent.bg?.heroAlt.value).toBe('Фасадата на хотела')
    })
  })

  describe("publishing a Portal's own look", () => {
    it('writes the effective look into the snapshot and the effective version with it', async () => {
      const scenario = withOwnLook(OWN_EVERYTHING_LOOK)
      await seedPortalWorkingCopy(getPool(), scenario)

      await publishFromSource(scenario, await sourceOf(scenario))

      const active = await createPortalPublicationRepository(getDb()).findActiveForPortal(
        scenario.organizationId,
        scenario.portalId,
      )
      expect(active?.configuration).toMatchObject({
        schemaVersion: 3,
        brandProfile: {
          // The public display name is always the Property's.
          displayName: 'Hotel Rila',
          wordmark: 'SPA',
          logo: { assetId: SCENARIO_OWN_LOGO_ASSET, width: 300, height: 300 },
          hero: {
            assetId: SCENARIO_OWN_HERO_ASSET,
            width: 1200,
            height: 800,
            focalX: 0.2,
            focalY: 0.4,
          },
          accentColour: '#B8860B',
          lookVersion: 6,
        },
        localizedContent: {
          bg: { heroAlt: { value: 'Басейнът', fallbackFrom: null } },
          en: { heroAlt: { value: 'The pool', fallbackFrom: null } },
        },
      })
      const { rows } = await getPool().query(
        `SELECT brand_profile_version FROM portal_publication_snapshots WHERE portal_id = $1`,
        [scenario.portalId],
      )
      expect(rows[0].brand_profile_version).toBe(6)
    })

    it('has no pending change straight after publishing, and one once the look moves', async () => {
      const scenario = withOwnLook(OWN_COLOURS_LOOK)
      await seedPortalWorkingCopy(getPool(), scenario)
      await publishFromSource(scenario, await sourceOf(scenario))
      await expect(workingCopyDiffersFromLive(scenario)).resolves.toBe(false)

      await getPool().query(
        `UPDATE portal_look_overrides SET primary_color = '#112233', look_version = 6`,
      )

      await expect(workingCopyDiffersFromLive(scenario)).resolves.toBe(true)
    })

    it('shows no pending change on a Portal that owns what the Property changed', async () => {
      const scenario = withOwnLook(OWN_COLOURS_LOOK)
      await seedPortalWorkingCopy(getPool(), scenario)
      await publishFromSource(scenario, await sourceOf(scenario))

      // The Property moves its accent and its look version, as its writer does.
      await getPool().query(
        `UPDATE property_portal_brand_profiles
            SET primary_color = '#00AA00', look_version = look_version + 1`,
      )

      await expect(workingCopyDiffersFromLive(scenario)).resolves.toBe(false)
    })

    it.each([
      [
        'its look version moves',
        `UPDATE portal_look_overrides SET look_version = look_version + 1`,
      ],
      [
        'its accent changes',
        `UPDATE portal_look_overrides SET primary_color = '#112233'`,
      ],
      ['its wordmark changes', `UPDATE portal_look_overrides SET wordmark = 'POOL'`],
      ['its logo is dropped', `UPDATE portal_look_overrides SET logo_asset_id = NULL`],
      [
        'its photo is anchored elsewhere',
        `UPDATE portal_look_overrides SET hero_focal_x = 0.9`,
      ],
      [
        'its photo description changes',
        `UPDATE portal_look_overrides SET hero_alt_texts = '{"bg": "Друго"}'::jsonb`,
      ],
      [
        'its photo is switched off',
        `UPDATE portal_look_overrides SET photo_mode = 'none', hero_asset_id = NULL,
           hero_focal_x = NULL, hero_focal_y = NULL, hero_alt_texts = '{}'::jsonb`,
      ],
      [
        'its colours go back to the Property’s',
        `UPDATE portal_look_overrides SET colours_mode = 'inherit', primary_color = NULL,
           background_mode = NULL, background_color = NULL`,
      ],
      [
        'its own photo is taken down',
        `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW()
          WHERE id = '${SCENARIO_OWN_HERO_ASSET}'`,
      ],
    ])('refuses to commit a snapshot when %s first', async (_name, mutation) => {
      const scenario = withOwnLook(OWN_EVERYTHING_LOOK)
      await seedPortalWorkingCopy(getPool(), scenario)
      const source = await sourceOf(scenario)

      await getPool().query(mutation)

      await expect(publishFromSource(scenario, source)).rejects.toMatchObject({
        code: 'revision_conflict',
      })
      const { rows } = await getPool().query(
        `SELECT count(*)::int AS count FROM portal_publication_snapshots WHERE portal_id = $1`,
        [scenario.portalId],
      )
      expect(rows[0].count).toBe(0)
    })

    it('refuses to commit a snapshot of a Portal that took a look of its own after the read', async () => {
      await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
      const source = await sourceOf(COMPLETE_SCENARIO)

      // Copying the Property's own values would move nothing a guest sees, but
      // the Portal's effective version is the row's, not the Property's.
      await seedPortalLookOverride(getPool(), scopeOf(COMPLETE_SCENARIO), {
        ...OWN_COLOURS_LOOK,
        lookVersion: 5,
      })

      await expect(publishFromSource(COMPLETE_SCENARIO, source)).rejects.toMatchObject({
        code: 'revision_conflict',
      })
    })
  })

  describe('an image of the look that cannot be shown', () => {
    it('reads a taken-down own photo as no photo, never as the Property’s', async () => {
      const scenario = withOwnLook(OWN_PHOTO_LOOK)
      await seedPortalWorkingCopy(getPool(), scenario)
      await getPool().query(
        `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW()
          WHERE id = $1`,
        [SCENARIO_OWN_HERO_ASSET],
      )

      const source = await sourceOf(scenario)
      const { brandProfile, localizedContent } = resolvePortalPublication(source).content

      expect(source.look?.hero).toBeNull()
      expect(brandProfile.hero).toBeNull()
      // With no photo there is nothing to describe, so no description is published.
      expect(localizedContent.bg?.heroAlt.value).toBe('')
      expect(localizedContent.en?.heroAlt.value).toBe('')
      await expect(readWithLook(scenario)).resolves.toMatchObject({
        lookSources: { photo: 'portal' },
      })
    })

    it('reads a taken-down own logo as no logo, not the Property’s', async () => {
      const scenario = withOwnLook(OWN_IDENTITY_LOOK)
      await seedPortalWorkingCopy(getPool(), scenario)
      await getPool().query(
        `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW()
          WHERE id = $1`,
        [SCENARIO_OWN_LOGO_ASSET],
      )

      const source = await sourceOf(scenario)

      expect(source.look?.logo).toBeNull()
      expect(source.look?.wordmark).toBe('SPA')
    })

    it('shows a Property photograph that was taken down to a Portal that follows it as none', async () => {
      await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
      await getPool().query(
        `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW()
          WHERE id = $1`,
        [SCENARIO_HERO_ASSET],
      )

      const source = await sourceOf(COMPLETE_SCENARIO)

      expect(source.look?.hero).toBeNull()
      expect(
        resolvePortalPublication(source).content.localizedContent.bg?.heroAlt.value,
      ).toBe('')
    })

    it('draws no photograph from an image uploaded for another slot', async () => {
      const scenario = withOwnLook(OWN_PHOTO_LOOK)
      await seedPortalWorkingCopy(getPool(), scenario)
      // The Portal's own photo names a logo.
      await getPool().query(`UPDATE portal_look_overrides SET hero_asset_id = $1`, [
        SCENARIO_OWN_LOGO_ASSET,
      ])

      const source = await sourceOf(scenario)

      expect(source.look?.hero).toBeNull()
    })

    it('draws no photograph or logo the Property named from an image uploaded for another slot', async () => {
      await seedPortalWorkingCopy(getPool(), withOwnLook(OWN_COLOURS_LOOK))
      // The Property's photograph names a tile picture, and its logo a photograph.
      await getPool().query(
        `UPDATE property_portal_brand_profiles SET hero_asset_id = $1, logo_asset_id = $2`,
        [SCENARIO_TILE_ASSET, SCENARIO_HERO_ASSET],
      )

      const source = await sourceOf(COMPLETE_SCENARIO)

      expect(source.look?.hero).toBeNull()
      expect(source.look?.logo).toBeNull()
    })
  })

  describe('a Property with no Brand Profile', () => {
    it('has no look, whatever a Portal’s row says', async () => {
      await seedPortalWorkingCopy(getPool(), NO_BRAND_SCENARIO)
      await seedPortalLookOverride(getPool(), scopeOf(NO_BRAND_SCENARIO), NO_PHOTO_LOOK)

      await expect(readWithLook(NO_BRAND_SCENARIO)).resolves.toEqual({
        source: NO_BRAND_GOLDEN,
        lookSources: PROPERTY_LOOK_SOURCES,
      })
    })
  })

  describe('a photo description in a language the Property wrote nothing in', () => {
    it('is the Portal’s own, held on a row that is not wording', async () => {
      const scenario: WorkingCopyScenario = {
        ...withOwnLook({
          photo: {
            mode: 'own',
            assetId: SCENARIO_OWN_HERO_ASSET,
            focalX: 0.5,
            focalY: 0.5,
            altTexts: { en: 'The pool', bg: 'Басейнът' },
          },
          lookVersion: 5,
        }),
        // Bulgarian is enabled but the Property wrote nothing in it.
        contents: COMPLETE_SCENARIO.contents.filter((row) => row.locale !== 'bg'),
        primaryGuestLocale: 'en',
        additionalGuestLocales: ['bg'],
      }
      await seedPortalWorkingCopy(getPool(), scenario)

      const source = await sourceOf(scenario)

      expect(source.wording.bg).toEqual({
        title: null,
        shortDescription: null,
        heroAlt: 'Басейнът',
        linktreeTitle: null,
      })
      expect(source.wording.en?.heroAlt).toBe('The pool')
    })
  })
})
