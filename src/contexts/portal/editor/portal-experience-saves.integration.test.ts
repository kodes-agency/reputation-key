// Portal context — the Property-wide brand profile and content and per-Portal
// localized override save use cases, over real PostgreSQL and two Organizations.
// The decisions pinned in the reads file hold here too: `portal.admin` authorizes
// Property-wide branding, the accessible text-contrast floor is checked before
// anything persists, and manager-supplied image URLs are never admitted.

import { describe, expect, it } from 'vitest'
import type { PropertyId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import {
  ensureDefaultPublicDisplayName,
  savePortalLocalizedOverride,
  savePropertyDefaultGuestLocales,
  savePropertyPortalBrandContent,
  savePropertyPublicDisplayName,
} from './manage-portal-experience.server'
import { AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR } from '../domain/portal-experience'
import {
  seedBrandProfile,
  seedMediaPortal,
} from '../infrastructure/testing/portal-media-experience-seed'
import {
  ORG_A,
  ORG_B,
  adminOf,
  contentRow,
  depsOf,
  eventTypes,
  getPool,
  managerOf,
  overrideRowOf,
  profileRow,
  query,
  rejectsWithPortalCode,
  scene,
  setupExperienceDb,
} from './portal-experience-world.test-fixtures'

setupExperienceDb()

describe('savePropertyPublicDisplayName (real PostgreSQL)', () => {
  it('refuses a PropertyManager: the public display name is Property-wide branding', async () => {
    const { property } = await scene()

    await rejectsWithPortalCode(
      savePropertyPublicDisplayName(depsOf())(
        { propertyId: property, displayName: 'Seaside Retreat' },
        managerOf(),
      ),
      'forbidden',
    )
    expect(await profileRow(property)).toBeUndefined()
  })

  it('saves the trimmed name alone, as the signed-in person', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const ctx = adminOf()

    await savePropertyPublicDisplayName(depsOf())(
      { propertyId: property, displayName: '  Seaside Retreat  ' },
      ctx,
    )

    expect(await profileRow(property)).toMatchObject({
      display_name: 'Seaside Retreat',
      primary_color: '#B8860B',
      background_color: '#1A1A1A',
      updated_by: ctx.userId,
    })
  })

  it('starts a Property with no look from the name alone', async () => {
    const { property } = await scene()
    const ctx = adminOf()

    await savePropertyPublicDisplayName(depsOf())(
      { propertyId: property, displayName: 'Seaside Retreat' },
      ctx,
    )

    expect(await profileRow(property)).toMatchObject({
      display_name: 'Seaside Retreat',
      updated_by: ctx.userId,
    })
  })

  it('refuses a blank or over-long display name', async () => {
    const { property } = await scene()
    const save = savePropertyPublicDisplayName(depsOf())

    await rejectsWithPortalCode(
      save({ propertyId: property, displayName: '  ' }, adminOf()),
      'invalid_description',
    )
    await rejectsWithPortalCode(
      save({ propertyId: property, displayName: 'x'.repeat(121) }, adminOf()),
      'invalid_description',
    )
    expect(await profileRow(property)).toBeUndefined()
  })
})

describe('ensureDefaultPublicDisplayName (real PostgreSQL)', () => {
  it('starts the public display name as the trimmed Property name, and never replaces one', async () => {
    const { property } = await scene()
    const ensure = (displayName: string) =>
      ensureDefaultPublicDisplayName(depsOf())({
        organizationId: ORG_A,
        propertyId: property,
        displayName,
      })

    await expect(ensure('  KODES agency ')).resolves.toBe(true)
    expect(await profileRow(property)).toMatchObject({
      display_name: 'KODES agency',
      updated_by: AUTOMATIC_PUBLIC_DISPLAY_NAME_ACTOR,
    })

    await expect(ensure('Another name')).resolves.toBe(false)
    expect((await profileRow(property)).display_name).toBe('KODES agency')
  })

  it('sets nothing for a name the public display name cannot hold', async () => {
    const { property } = await scene()

    for (const displayName of ['   ', 'x'.repeat(121)]) {
      await expect(
        ensureDefaultPublicDisplayName(depsOf())({
          organizationId: ORG_A,
          propertyId: property,
          displayName,
        }),
      ).resolves.toBe(false)
    }
    expect(await profileRow(property)).toBeUndefined()
  })
})

describe('savePropertyDefaultGuestLocales (real PostgreSQL)', () => {
  it('refuses a PropertyManager: default languages are Property-wide branding', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await rejectsWithPortalCode(
      savePropertyDefaultGuestLocales(depsOf())(
        { propertyId: property, locales: ['bg'] },
        managerOf(),
      ),
      'forbidden',
    )
    expect((await profileRow(property)).default_guest_locales).toEqual(['en'])
  })

  it('saves the ordered set for the signed-in organisation and returns the profile', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    const saved = await savePropertyDefaultGuestLocales(depsOf())(
      { propertyId: property, locales: ['bg', 'en'] },
      adminOf(),
    )

    expect(saved.defaultGuestLocales).toEqual(['bg', 'en'])
    expect((await profileRow(property)).default_guest_locales).toEqual(['bg', 'en'])
  })

  it('refuses an empty set and a repeated language before anything persists', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const save = savePropertyDefaultGuestLocales(depsOf())

    await rejectsWithPortalCode(
      save({ propertyId: property, locales: [] }, adminOf()),
      'locale_not_offered',
    )
    await rejectsWithPortalCode(
      save({ propertyId: property, locales: ['en', 'en'] }, adminOf()),
      'locale_not_offered',
    )
    expect((await profileRow(property)).default_guest_locales).toEqual(['en'])
  })

  it('says so when the Property has no Brand Profile to hold them', async () => {
    const { property } = await scene()

    await rejectsWithPortalCode(
      savePropertyDefaultGuestLocales(depsOf())(
        { propertyId: property, locales: ['en'] },
        adminOf(),
      ),
      'brand_profile_missing',
    )
  })

  it('does not reach another Organization’s profile', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await rejectsWithPortalCode(
      savePropertyDefaultGuestLocales(depsOf())(
        { propertyId: property, locales: ['bg'] },
        adminOf(ORG_B),
      ),
      'brand_profile_missing',
    )
    expect((await profileRow(property)).default_guest_locales).toEqual(['en'])
  })
})

describe('savePropertyPortalBrandContent (real PostgreSQL)', () => {
  const contentOf = (property: PropertyId) => ({
    propertyId: property,
    locale: 'bg' as const,
    title: '  Морски бряг  ',
    shortDescription: '  Кажете ни как мина престоят ви.  ',
  })

  it('refuses a PropertyManager: Property-wide guest copy needs portal.admin', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await rejectsWithPortalCode(
      savePropertyPortalBrandContent(depsOf())(contentOf(property), managerOf()),
      'forbidden',
    )
    expect(await contentRow(property, 'bg')).toBeUndefined()
  })

  it('persists trimmed guest copy under the requested locale', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const ctx = adminOf()

    await savePropertyPortalBrandContent(depsOf())(contentOf(property), ctx)

    expect(await contentRow(property, 'bg')).toMatchObject({
      title: 'Морски бряг',
      short_description: 'Кажете ни как мина престоят ви.',
      updated_by: ctx.userId,
    })
    expect(await contentRow(property, 'en')).toBeUndefined()
    expect(await eventTypes()).toContain('portal.property_brand_content.updated')
  })

  it('keeps a trimmed hero alt text, clears it with null or spaces, and keeps it when left out', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const save = savePropertyPortalBrandContent(depsOf())
    const content = contentOf(property)

    await save({ ...content, heroAltText: '  Лодки в пристанището  ' }, adminOf())
    expect((await contentRow(property, 'bg')).hero_alt_text).toBe('Лодки в пристанището')

    await save(content, adminOf())
    expect((await contentRow(property, 'bg')).hero_alt_text).toBe('Лодки в пристанището')

    await save({ ...content, heroAltText: null }, adminOf())
    expect((await contentRow(property, 'bg')).hero_alt_text).toBeNull()

    await save({ ...content, heroAltText: '  Лодки  ' }, adminOf())
    await save({ ...content, heroAltText: '  ' }, adminOf())
    expect((await contentRow(property, 'bg')).hero_alt_text).toBeNull()
  })

  it('refuses a hero alt text over 160 characters', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    await rejectsWithPortalCode(
      savePropertyPortalBrandContent(depsOf())(
        { ...contentOf(property), heroAltText: 'x'.repeat(161) },
        adminOf(),
      ),
      'invalid_description',
    )
    expect(await contentRow(property, 'bg')).toBeUndefined()
  })

  it('refuses a title over 120 or a description over 500 characters', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)
    const save = savePropertyPortalBrandContent(depsOf())

    await rejectsWithPortalCode(
      save({ ...contentOf(property), title: 'x'.repeat(121) }, adminOf()),
      'invalid_description',
    )
    await rejectsWithPortalCode(
      save({ ...contentOf(property), shortDescription: 'x'.repeat(501) }, adminOf()),
      'invalid_description',
    )
    expect(await contentRow(property, 'bg')).toBeUndefined()
  })

  it('accepts a title of exactly 120 and a description of exactly 500 characters', async () => {
    const { property } = await scene()
    await seedBrandProfile(getPool(), ORG_A, property)

    // Pinning the accepting side too keeps the threshold from being "fixed" by
    // tightening it: 120 and 500 are the boundaries, not merely upper bounds.
    await savePropertyPortalBrandContent(depsOf())(
      {
        ...contentOf(property),
        title: 'x'.repeat(120),
        shortDescription: 'y'.repeat(500),
      },
      adminOf(),
    )

    expect(await contentRow(property, 'bg')).toMatchObject({
      title: 'x'.repeat(120),
      short_description: 'y'.repeat(500),
    })
  })
})

describe('savePortalLocalizedOverride (real PostgreSQL)', () => {
  const withHeroImageUrl = (
    input: Parameters<ReturnType<typeof savePortalLocalizedOverride>>[0],
    heroImageUrl: string,
  ): Parameters<ReturnType<typeof savePortalLocalizedOverride>>[0] =>
    // A caller that got past the DTO carrying a hero image URL.
    ({ ...input, heroImageUrl }) as unknown as Parameters<
      ReturnType<typeof savePortalLocalizedOverride>
    >[0]

  async function overrideScene(state: 'draft' | 'archived' = 'draft') {
    const { property } = await scene()
    const portal = await seedMediaPortal(getPool(), ORG_A, property, { state })
    return { property, portal }
  }

  it('normalizes non-null override copy and drops a caller-supplied hero image URL', async () => {
    const { portal } = await overrideScene()
    const ctx = managerOf()

    await savePortalLocalizedOverride(depsOf())(
      withHeroImageUrl(
        {
          portalId: portal,
          locale: 'en',
          title: '  Rooftop Bar  ',
          shortDescription: '  Tell us about tonight.  ',
        },
        'https://cdn.example.com/hero.png',
      ),
      ctx,
    )

    expect(await overrideRowOf(portal)).toMatchObject({
      title: 'Rooftop Bar',
      short_description: 'Tell us about tonight.',
      hero_image_url: null,
      updated_by: ctx.userId,
      organization_id: ORG_A,
    })
    expect(await eventTypes()).toContain('portal.localized_override.updated')
  })

  it('carries an explicit null through as a cleared override rather than rejecting it', async () => {
    const { portal } = await overrideScene()
    const save = savePortalLocalizedOverride(depsOf())
    const clear = () =>
      save(
        { portalId: portal, locale: 'en', title: null, shortDescription: null },
        managerOf(),
      )
    await save(
      {
        portalId: portal,
        locale: 'en',
        title: 'Rooftop Bar',
        shortDescription: 'Tonight',
      },
      managerOf(),
    )

    await clear()

    // A cleared override holds nothing, so there is no row: the Property's copy shows.
    expect(await overrideRowOf(portal)).toBeUndefined()

    // A row that still carries the Linktree title is kept, with the copy cleared.
    await save(
      { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
      managerOf(),
    )
    await query(
      `UPDATE portal_localized_overrides SET linktree_title = 'Around us' WHERE portal_id = $1`,
      [portal],
    )
    await clear()
    expect(await overrideRowOf(portal)).toMatchObject({
      title: null,
      short_description: null,
      hero_image_url: null,
    })
  })

  it('refuses to change content on an archived Portal', async () => {
    const { portal } = await overrideScene('archived')

    await rejectsWithPortalCode(
      savePortalLocalizedOverride(depsOf())(
        { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
        managerOf(),
      ),
      'portal_inactive',
    )
    expect(await overrideRowOf(portal)).toBeUndefined()
  })

  it('refuses a Member: per-Portal guest content needs portal.update', async () => {
    const { portal } = await overrideScene()

    await rejectsWithPortalCode(
      savePortalLocalizedOverride(depsOf())(
        { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
        buildTestAuthContext({ role: 'Member', organizationId: ORG_A }),
      ),
      'forbidden',
    )
    expect(await overrideRowOf(portal)).toBeUndefined()
  })

  it('does not find a Portal of another Organization, and writes nothing for it', async () => {
    const { portal } = await overrideScene()

    await rejectsWithPortalCode(
      savePortalLocalizedOverride(depsOf())(
        { portalId: portal, locale: 'en', title: 'Rooftop Bar', shortDescription: null },
        managerOf(ORG_B),
      ),
      'portal_not_found',
    )
    expect(await overrideRowOf(portal)).toBeUndefined()
    expect(await eventTypes(ORG_B)).toEqual([])
  })

  it('refuses an override title over 120 or an override description over 500 characters', async () => {
    const { portal } = await overrideScene()
    const save = savePortalLocalizedOverride(depsOf())

    await rejectsWithPortalCode(
      save(
        {
          portalId: portal,
          locale: 'en',
          title: 'x'.repeat(121),
          shortDescription: null,
        },
        managerOf(),
      ),
      'invalid_description',
    )
    await rejectsWithPortalCode(
      save(
        {
          portalId: portal,
          locale: 'en',
          title: null,
          shortDescription: 'x'.repeat(501),
        },
        managerOf(),
      ),
      'invalid_description',
    )
    expect(await overrideRowOf(portal)).toBeUndefined()
  })

  it('accepts an override title of exactly 120 and a description of exactly 500 characters', async () => {
    const { portal } = await overrideScene()

    await savePortalLocalizedOverride(depsOf())(
      {
        portalId: portal,
        locale: 'en',
        title: 'x'.repeat(120),
        shortDescription: 'y'.repeat(500),
      },
      managerOf(),
    )

    expect(await overrideRowOf(portal)).toMatchObject({
      title: 'x'.repeat(120),
      short_description: 'y'.repeat(500),
      hero_image_url: null,
    })
  })
})
