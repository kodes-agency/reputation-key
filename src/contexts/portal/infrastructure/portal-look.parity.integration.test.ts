// The working-copy reader and the draft preview resolve a Portal's look in two
// places (ADR 0070). Publish and the in-transaction verification read the first;
// the editor's phone shows the second. They lay the Portal's own groups over the
// Property's with the same two functions, so the phone must show what publishing
// writes. This test seeds each combination of groups by SQL and compares the
// content the two produce: the brand (name, wordmark, logo, photo and focal
// point, accent, field) and the photo description of every language.
//
// Known differences the two still have are not hidden: they are listed in
// KNOWN_DIFFERENCES and pinned, so a change to one of them is noticed.

import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { portalMediaPublicPath } from '#/shared/domain/portal-media'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { resolvePortalPublication } from '../domain/portal-publication-source'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import {
  createPreviewUseCase,
  seedScenarioForPreview,
} from './testing/portal-preview-use-case'
import {
  COMPLETE_SCENARIO,
  INCOMPLETE_SCENARIO,
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

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_link_texts',
    'portal_localized_overrides',
    'portal_look_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

/** The languages the scenario's Portal offers; the primary first. */
const localesOf = (scenario: WorkingCopyScenario): readonly GuestLocale[] =>
  [scenario.primaryGuestLocale, ...scenario.additionalGuestLocales] as GuestLocale[]

type LookContent = Readonly<{
  brand: unknown
  heroAlt: Readonly<Record<string, unknown>>
}>

const mediaOf = (reference: { assetId: string; width: number; height: number } | null) =>
  reference && {
    url: portalMediaPublicPath(reference.assetId),
    width: reference.width,
    height: reference.height,
  }

/** What publishing writes of the look, in the shape the page (and so the preview) draws it. */
async function publishedLook(scenario: WorkingCopyScenario): Promise<LookContent> {
  const source = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
    scenario.organizationId,
    scenario.portalId,
  )
  if (!source) throw new Error('the scenario has no working copy')
  const { brandProfile, localizedContent } = resolvePortalPublication(source).content
  return {
    brand: {
      displayName: brandProfile.displayName,
      wordmark: brandProfile.wordmark,
      logo: mediaOf(brandProfile.logo),
      hero: brandProfile.hero && {
        ...mediaOf(brandProfile.hero),
        focalX: brandProfile.hero.focalX,
        focalY: brandProfile.hero.focalY,
      },
      accentColour: brandProfile.accentColour,
      fieldColour: brandProfile.fieldColour,
    },
    heroAlt: Object.fromEntries(
      localesOf(scenario).map((locale) => [locale, localizedContent[locale]?.heroAlt]),
    ),
  }
}

/** What the editor's phone shows of the look. */
async function previewedLook(scenario: WorkingCopyScenario): Promise<LookContent> {
  const outcome = await createPreviewUseCase()(
    { portalId: scenario.portalId, source: 'draft' },
    buildTestAuthContext({
      organizationId: scenario.organizationId,
      role: 'AccountAdmin',
    }),
  )
  if (outcome.status !== 'ready') throw new Error('expected a draft preview')
  const experience = (locale: GuestLocale) => {
    const found = outcome.preview.experiences[locale]
    if (!found) throw new Error(`no ${locale} experience`)
    return found
  }
  const locales = localesOf(scenario)
  return {
    brand: experience(locales[0] ?? 'en').brand,
    heroAlt: Object.fromEntries(
      locales.map((locale) => [locale, experience(locale).content.heroAlt]),
    ),
  }
}

const PARITY_SCENARIOS: ReadonlyArray<readonly [string, WorkingCopyScenario]> = [
  ['follows the whole Property look', COMPLETE_SCENARIO],
  ['a language with no wording', INCOMPLETE_SCENARIO],
  ['a Property with no Brand Profile', NO_BRAND_SCENARIO],
  ['its own photo, described', withOwnLook(OWN_PHOTO_LOOK)],
  ['its own photo, not described', withOwnLook(OWN_PHOTO_WITHOUT_ALT_LOOK)],
  ['no photo', withOwnLook(NO_PHOTO_LOOK)],
  ['its own colours, automatic background', withOwnLook(OWN_COLOURS_LOOK)],
  [
    'its own colours, background chosen by hand',
    withOwnLook({
      colours: {
        accent: '#B8860B',
        backgroundMode: 'manual',
        backgroundColour: '#2a1f10',
      },
      lookVersion: 5,
    }),
  ],
  ['its own name and logo', withOwnLook(OWN_IDENTITY_LOOK)],
  [
    'its own name and no logo, so the display name',
    withOwnLook({ identity: { wordmark: null, logoAssetId: null }, lookVersion: 5 }),
  ],
  ['all three groups', withOwnLook(OWN_EVERYTHING_LOOK)],
  [
    'a Property that follows a manual lowercase background',
    {
      ...COMPLETE_SCENARIO,
      brand: { ...COMPLETE_SCENARIO.brand!, backgroundColor: '#abcdef' },
    },
  ],
]

describe.sequential('the draft preview and the working copy agree on the look', () => {
  it.each(PARITY_SCENARIOS)('when a Portal %s', async (_name, scenario) => {
    await seedScenarioForPreview(getPool(), scenario)

    await expect(previewedLook(scenario)).resolves.toEqual(await publishedLook(scenario))
  })

  it('when the Portal’s own photo is taken down', async () => {
    const scenario = withOwnLook(OWN_PHOTO_LOOK)
    await seedScenarioForPreview(getPool(), scenario)
    await getPool().query(
      `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW() WHERE id = $1`,
      [SCENARIO_OWN_HERO_ASSET],
    )

    const published = await publishedLook(scenario)

    expect(published).toMatchObject({ brand: { hero: null } })
    await expect(previewedLook(scenario)).resolves.toEqual(published)
  })

  it('when the Property’s photograph is taken down under a Portal that follows it', async () => {
    await seedScenarioForPreview(getPool(), COMPLETE_SCENARIO)
    await getPool().query(
      `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW() WHERE id = $1`,
      [SCENARIO_HERO_ASSET],
    )

    const published = await publishedLook(COMPLETE_SCENARIO)

    expect(published).toMatchObject({ brand: { hero: null } })
    await expect(previewedLook(COMPLETE_SCENARIO)).resolves.toEqual(published)
  })

  it('when the Portal’s own logo is taken down', async () => {
    const scenario = withOwnLook(OWN_IDENTITY_LOOK)
    await seedScenarioForPreview(getPool(), scenario)
    await getPool().query(
      `UPDATE portal_media_assets SET status = 'taken_down', taken_down_at = NOW() WHERE id = $1`,
      [SCENARIO_OWN_LOGO_ASSET],
    )

    const published = await publishedLook(scenario)

    expect(published).toMatchObject({ brand: { logo: null, wordmark: 'SPA' } })
    await expect(previewedLook(scenario)).resolves.toEqual(published)
  })

  it('when an image was uploaded for another slot than the one that names it', async () => {
    const scenario = withOwnLook(OWN_PHOTO_LOOK)
    await seedScenarioForPreview(getPool(), scenario)
    // The Portal's photograph names a logo, the Property's logo a tile picture.
    await getPool().query(`UPDATE portal_look_overrides SET hero_asset_id = $1`, [
      SCENARIO_OWN_LOGO_ASSET,
    ])
    await getPool().query(
      `UPDATE property_portal_brand_profiles SET logo_asset_id = $1`,
      [SCENARIO_TILE_ASSET],
    )

    const published = await publishedLook(scenario)

    expect(published).toMatchObject({ brand: { hero: null, logo: null } })
    await expect(previewedLook(scenario)).resolves.toEqual(published)
  })

  // KNOWN_DIFFERENCES: what the two still do not agree on. Both need data the
  // writers never make (the use cases refuse a blank name), and the preview is
  // the lenient one by design (portal-preview.ts), so they are pinned here
  // rather than changed with this feature.
  describe('known differences', () => {
    it('a public display name that is only spaces: published as it is, previewed as the Portal’s name', async () => {
      await seedScenarioForPreview(getPool(), COMPLETE_SCENARIO)
      await getPool().query(
        `UPDATE property_portal_brand_profiles SET display_name = '   '`,
      )

      const published = await publishedLook(COMPLETE_SCENARIO)
      const previewed = await previewedLook(COMPLETE_SCENARIO)

      expect(published).toMatchObject({ brand: { displayName: '   ' } })
      expect(previewed).toMatchObject({ brand: { displayName: 'Lobby portal' } })
      expect({ ...(previewed.brand as object), displayName: '   ' }).toEqual(
        published.brand,
      )
    })
  })
})
