// Portal context — Property-wide brand profile / content and per-Portal
// localized override use cases.
//
// Three decisions are worth pinning here, because each of them is the only
// thing standing between a manager and a broken guest page:
//   * `portal.admin` — NOT ordinary `portal.update` — is what authorizes
//     Property-wide branding, so a PropertyManager is refused on the save
//     paths AND reported `canManagePropertyBrand: false` on both read paths;
//   * the accessible text-contrast floor is checked BEFORE anything persists;
//   * manager-supplied image URLs are never admitted, whatever the caller sent.

import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { isPortalError } from '../../domain/errors'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import {
  getPropertyPortalExperience,
  savePortalLocalizedOverride,
  savePropertyPortalBrandContent,
  savePropertyPortalBrandProfile,
} from './manage-portal-experience'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')
const GENERATED_ID = 'e0000000-0000-4000-8000-000000000001'

const failsWith = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

/** Denies every permission — the dynamic resolver path, not a built-in role. */
const withoutPermissions = (): AuthContext =>
  buildTestAuthContext({ effectivePermissions: new Set() })

const createExperienceRepo = () => ({
  getPropertyExperience: vi.fn<PortalExperienceRepository['getPropertyExperience']>(
    async () => ({ profile: null, content: [] }),
  ),
  listPortalOverrides: vi.fn<PortalExperienceRepository['listPortalOverrides']>(
    async () => [],
  ),
  savePropertyProfile: vi.fn<PortalExperienceRepository['savePropertyProfile']>(
    async (input) => ({
      ...input.profile,
      id: input.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      version: 1,
      updatedBy: input.updatedBy,
      createdAt: input.at,
      updatedAt: input.at,
    }),
  ),
  savePropertyContent: vi.fn<PortalExperienceRepository['savePropertyContent']>(
    async (input) => ({
      id: input.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      locale: input.locale,
      title: input.content.title,
      shortDescription: input.content.shortDescription,
      version: 1,
      updatedBy: input.updatedBy,
      createdAt: input.at,
      updatedAt: input.at,
    }),
  ),
  savePortalOverride: vi.fn<PortalExperienceRepository['savePortalOverride']>(
    async (input) => ({
      ...input.override,
      id: input.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      locale: input.locale,
      version: 1,
      updatedBy: input.updatedBy,
      createdAt: input.at,
      updatedAt: input.at,
    }),
  ),
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const experienceRepo = createExperienceRepo()
  const portalRepo = createInMemoryPortalRepo()
  return {
    experienceRepo,
    portalRepo,
    deps: {
      experienceRepo,
      portalRepo,
      staffPublicApi: staffApiMock(accessible),
      idGen: () => GENERATED_ID,
      clock: () => NOW,
    },
  }
}

const brandProfileInput = (
  overrides: Readonly<Record<string, unknown>> = {},
): Parameters<ReturnType<typeof savePropertyPortalBrandProfile>>[0] =>
  // The DTO types the two image fields as `null`, so a well-typed caller cannot
  // supply a URL. The cast reproduces a caller that got past the DTO — the
  // suppression below has to hold on its own, not by grace of the type.
  ({
    propertyId: PROPERTY,
    displayName: '  Seaside Retreat  ',
    primaryColor: '#6366f1',
    backgroundColor: '#ffffff',
    textColor: '#111827',
    logoUrl: 'https://cdn.example.com/logo.png',
    defaultHeroImageUrl: 'https://cdn.example.com/hero.png',
    ...overrides,
  }) as unknown as Parameters<ReturnType<typeof savePropertyPortalBrandProfile>>[0]

/**
 * Reproduces a caller that got past the DTO carrying a hero image URL. The DTO
 * types `heroImageUrl` as `null`, so a well-typed caller cannot supply one —
 * the suppression has to hold on its own, not by grace of the type.
 */
const withHeroImageUrl = (
  input: Parameters<ReturnType<typeof savePortalLocalizedOverride>>[0],
  heroImageUrl: string,
): Parameters<ReturnType<typeof savePortalLocalizedOverride>>[0] =>
  ({ ...input, heroImageUrl }) as unknown as Parameters<
    ReturnType<typeof savePortalLocalizedOverride>
  >[0]

describe('getPropertyPortalExperience', () => {
  it('returns the Property experience with no overrides and no brand authority for Staff', async () => {
    const { deps, experienceRepo } = setup([PROPERTY])
    const ctx = buildTestAuthContext({ role: 'Staff' })

    const result = await getPropertyPortalExperience(deps)({ propertyId: PROPERTY }, ctx)

    expect(result).toEqual({
      profile: null,
      content: [],
      overrides: [],
      canManagePropertyBrand: false,
    })
    expect(experienceRepo.getPropertyExperience).toHaveBeenCalledWith(ORG, PROPERTY)
    // No portal was named, so the per-Portal override read must not happen.
    expect(experienceRepo.listPortalOverrides).not.toHaveBeenCalled()
  })

  it('reads the named Portal overrides and reports brand authority for an Account Admin', async () => {
    const { deps, experienceRepo, portalRepo } = setup()
    const portal = buildTestPortal({ propertyId: PROPERTY })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await getPropertyPortalExperience(deps)(
      { propertyId: PROPERTY, portalId: portal.id },
      ctx,
    )

    expect(result.canManagePropertyBrand).toBe(true)
    expect(experienceRepo.listPortalOverrides).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      portal.id,
    )
  })

  it('withholds brand authority from a PropertyManager on both the Property and named-Portal reads', async () => {
    const { deps, portalRepo } = setup([PROPERTY])
    const portal = buildTestPortal({ propertyId: PROPERTY })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    // PropertyManager is the only role that separates the two permissions: it
    // holds portal.update but not portal.admin. Reporting `true` here would
    // hand a manager an editable Property-brand form that assertPortalAdmin
    // then refuses to save, so both read paths are pinned.
    const propertyOnly = await getPropertyPortalExperience(deps)(
      { propertyId: PROPERTY },
      ctx,
    )
    const withPortal = await getPropertyPortalExperience(deps)(
      { propertyId: PROPERTY, portalId: portal.id },
      ctx,
    )

    expect(propertyOnly.canManagePropertyBrand).toBe(false)
    expect(withPortal.canManagePropertyBrand).toBe(false)
  })

  it('refuses a Portal that belongs to a different Property', async () => {
    const { deps, portalRepo } = setup()
    const portal = buildTestPortal({ propertyId: OTHER_PROPERTY })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // The Portal is readable in this organization; naming it under the wrong
    // Property would splice one Property's overrides onto another's brand.
    await expect(
      getPropertyPortalExperience(deps)(
        { propertyId: PROPERTY, portalId: portal.id },
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('portal_not_found'))
  })

  it('refuses a reader whose assignment excludes the Property', async () => {
    const { deps, experienceRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      getPropertyPortalExperience(deps)({ propertyId: PROPERTY }, ctx),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(experienceRepo.getPropertyExperience).not.toHaveBeenCalled()
  })

  it('refuses a caller without portal.read before it touches the repository', async () => {
    const { deps, experienceRepo } = setup()

    await expect(
      getPropertyPortalExperience(deps)({ propertyId: PROPERTY }, withoutPermissions()),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(experienceRepo.getPropertyExperience).not.toHaveBeenCalled()
  })
})

describe('savePropertyPortalBrandProfile', () => {
  it('refuses a PropertyManager — Property-wide branding needs portal.admin', async () => {
    const { deps, experienceRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      savePropertyPortalBrandProfile(deps)(brandProfileInput(), ctx),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(experienceRepo.savePropertyProfile).not.toHaveBeenCalled()
  })

  it('persists a trimmed name and upper-cased colours, and never a caller-supplied image URL', async () => {
    const { deps, experienceRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const saved = await savePropertyPortalBrandProfile(deps)(brandProfileInput(), ctx)

    expect(experienceRepo.savePropertyProfile).toHaveBeenCalledWith({
      id: GENERATED_ID,
      organizationId: ORG,
      propertyId: PROPERTY,
      profile: {
        displayName: 'Seaside Retreat',
        logoUrl: null,
        defaultHeroImageUrl: null,
        primaryColor: '#6366F1',
        backgroundColor: '#FFFFFF',
        textColor: '#111827',
      },
      updatedBy: ctx.userId,
      at: NOW,
    })
    expect(saved.logoUrl).toBeNull()
    expect(saved.defaultHeroImageUrl).toBeNull()
  })

  it('refuses text colour below the 4.5 contrast floor', async () => {
    const { deps, experienceRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // #999999 on #FFFFFF is roughly 2.8:1 — legible enough to look fine in a
    // colour picker and far below what a guest on a phone outdoors can read.
    await expect(
      savePropertyPortalBrandProfile(deps)(
        brandProfileInput({ textColor: '#999999' }),
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    expect(experienceRepo.savePropertyProfile).not.toHaveBeenCalled()
  })

  it('refuses a colour that is not a six-digit hex', async () => {
    const { deps } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      savePropertyPortalBrandProfile(deps)(
        brandProfileInput({ primaryColor: 'rebeccapurple' }),
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
    await expect(
      savePropertyPortalBrandProfile(deps)(brandProfileInput({ textColor: '#111' }), ctx),
    ).rejects.toSatisfy(failsWith('invalid_theme'))
  })

  it('refuses a blank or over-long display name', async () => {
    const { deps } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      savePropertyPortalBrandProfile(deps)(
        brandProfileInput({ displayName: '   ' }),
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    await expect(
      savePropertyPortalBrandProfile(deps)(
        brandProfileInput({ displayName: 'x'.repeat(121) }),
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
  })
})

describe('savePropertyPortalBrandContent', () => {
  const content = {
    propertyId: PROPERTY,
    locale: 'bg' as const,
    title: '  Морски бряг  ',
    shortDescription: '  Кажете ни как мина престоят ви.  ',
  }

  it('refuses a PropertyManager — Property-wide guest copy needs portal.admin', async () => {
    const { deps, experienceRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(savePropertyPortalBrandContent(deps)(content, ctx)).rejects.toSatisfy(
      failsWith('forbidden'),
    )
    expect(experienceRepo.savePropertyContent).not.toHaveBeenCalled()
  })

  it('persists trimmed guest copy under the requested locale', async () => {
    const { deps, experienceRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await savePropertyPortalBrandContent(deps)(content, ctx)

    expect(experienceRepo.savePropertyContent).toHaveBeenCalledWith({
      id: GENERATED_ID,
      organizationId: ORG,
      propertyId: PROPERTY,
      locale: 'bg',
      content: {
        title: 'Морски бряг',
        shortDescription: 'Кажете ни как мина престоят ви.',
      },
      updatedBy: ctx.userId,
      at: NOW,
    })
  })

  it('refuses a title over 120 or a description over 500 characters', async () => {
    const { deps, experienceRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      savePropertyPortalBrandContent(deps)({ ...content, title: 'x'.repeat(121) }, ctx),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    await expect(
      savePropertyPortalBrandContent(deps)(
        { ...content, shortDescription: 'x'.repeat(501) },
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(experienceRepo.savePropertyContent).not.toHaveBeenCalled()
  })

  it('accepts a title of exactly 120 and a description of exactly 500 characters', async () => {
    const { deps, experienceRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // Pinning the accepting side too keeps the threshold from being "fixed" by
    // tightening it — 120/500 are the boundaries, not merely upper bounds.
    await savePropertyPortalBrandContent(deps)(
      { ...content, title: 'x'.repeat(120), shortDescription: 'y'.repeat(500) },
      ctx,
    )

    expect(experienceRepo.savePropertyContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { title: 'x'.repeat(120), shortDescription: 'y'.repeat(500) },
      }),
    )
  })
})

describe('savePortalLocalizedOverride', () => {
  it('normalizes non-null override copy and drops a caller-supplied hero image URL', async () => {
    const { deps, experienceRepo, portalRepo } = setup()
    const portal = buildTestPortal({ propertyId: PROPERTY })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await savePortalLocalizedOverride(deps)(
      withHeroImageUrl(
        {
          portalId: portal.id,
          locale: 'en',
          title: '  Rooftop Bar  ',
          shortDescription: '  Tell us about tonight.  ',
        },
        'https://cdn.example.com/hero.png',
      ),
      ctx,
    )

    expect(experienceRepo.savePortalOverride).toHaveBeenCalledWith({
      id: GENERATED_ID,
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: portal.id,
      locale: 'en',
      override: {
        title: 'Rooftop Bar',
        shortDescription: 'Tell us about tonight.',
        heroImageUrl: null,
      },
      updatedBy: ctx.userId,
      at: NOW,
    })
  })

  it('carries an explicit null through as a cleared override rather than rejecting it', async () => {
    const { deps, experienceRepo, portalRepo } = setup()
    const portal = buildTestPortal({ propertyId: PROPERTY })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await savePortalLocalizedOverride(deps)(
      { portalId: portal.id, locale: 'en', title: null, shortDescription: null },
      ctx,
    )

    expect(experienceRepo.savePortalOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        override: { title: null, shortDescription: null, heroImageUrl: null },
      }),
    )
  })

  it('refuses to change content on an archived Portal', async () => {
    const { deps, experienceRepo, portalRepo } = setup()
    const portal = buildTestPortal({
      propertyId: PROPERTY,
      publicationState: 'archived',
    })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      savePortalLocalizedOverride(deps)(
        {
          portalId: portal.id,
          locale: 'en',
          title: 'Rooftop Bar',
          shortDescription: null,
        },
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('portal_inactive'))
    expect(experienceRepo.savePortalOverride).not.toHaveBeenCalled()
  })

  it('refuses Staff — per-Portal guest content needs portal.update', async () => {
    const { deps, experienceRepo, portalRepo } = setup()
    const portal = buildTestPortal({ propertyId: PROPERTY })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      savePortalLocalizedOverride(deps)(
        {
          portalId: portal.id,
          locale: 'en',
          title: 'Rooftop Bar',
          shortDescription: null,
        },
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('forbidden'))
    expect(experienceRepo.savePortalOverride).not.toHaveBeenCalled()
  })

  it('refuses an override title over 120 or an override description over 500 characters', async () => {
    const { deps, experienceRepo, portalRepo } = setup()
    const portal = buildTestPortal({ propertyId: PROPERTY })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      savePortalLocalizedOverride(deps)(
        {
          portalId: portal.id,
          locale: 'en',
          title: 'x'.repeat(121),
          shortDescription: null,
        },
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    await expect(
      savePortalLocalizedOverride(deps)(
        {
          portalId: portal.id,
          locale: 'en',
          title: null,
          shortDescription: 'x'.repeat(501),
        },
        ctx,
      ),
    ).rejects.toSatisfy(failsWith('invalid_description'))
    expect(experienceRepo.savePortalOverride).not.toHaveBeenCalled()
  })

  it('accepts an override title of exactly 120 and a description of exactly 500 characters', async () => {
    const { deps, experienceRepo, portalRepo } = setup()
    const portal = buildTestPortal({ propertyId: PROPERTY })
    portalRepo.seed([portal])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await savePortalLocalizedOverride(deps)(
      {
        portalId: portal.id,
        locale: 'en',
        title: 'x'.repeat(120),
        shortDescription: 'y'.repeat(500),
      },
      ctx,
    )

    expect(experienceRepo.savePortalOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        override: {
          title: 'x'.repeat(120),
          shortDescription: 'y'.repeat(500),
          heroImageUrl: null,
        },
      }),
    )
  })
})
