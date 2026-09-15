import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import {
  portalId,
  propertyId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import { assertPropertyAccess } from '../assert-property-access'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  contrastRatio,
  isPublicDisplayNameConfirmed,
} from '../../domain/portal-experience'
import { portalError } from '../../domain/errors'

type Deps = Readonly<{
  experienceRepo: PortalExperienceRepository
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

function assertPortalAdmin(ctx: AuthContext): void {
  if (!canForContext(ctx, 'portal.admin')) {
    throw portalError(
      'forbidden',
      'Only an Account Admin can change Property-wide Portal branding',
    )
  }
}

function normalizedRequired(value: string, field: string, max: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > max) {
    throw portalError('invalid_description', `${field} must be 1 to ${max} characters`)
  }
  return normalized
}

export const getPropertyPortalExperience =
  (deps: Deps) =>
  async (
    input: Readonly<{ propertyId: string; portalId?: string }>,
    ctx: AuthContext,
  ) => {
    if (!canForContext(ctx, 'portal.read')) {
      throw portalError('forbidden', 'Insufficient permissions to read Portal branding')
    }
    const pid = propertyId(input.propertyId)
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.read', pid)
    const propertyExperience = await deps.experienceRepo.getPropertyExperience(
      ctx.organizationId,
      pid,
    )
    const publicDisplayNameConfirmed = isPublicDisplayNameConfirmed(
      propertyExperience.profile,
    )
    if (!input.portalId) {
      return {
        ...propertyExperience,
        overrides: [],
        canManagePropertyBrand: canForContext(ctx, 'portal.admin'),
        publicDisplayNameConfirmed,
      }
    }
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to read Portal guest content',
    })
    if (portal.propertyId !== pid) {
      throw portalError('portal_not_found', 'Portal not found for this Property')
    }
    return {
      ...propertyExperience,
      overrides: await deps.experienceRepo.listPortalOverrides(
        ctx.organizationId,
        pid,
        portal.id,
      ),
      canManagePropertyBrand: canForContext(ctx, 'portal.admin'),
      publicDisplayNameConfirmed,
    }
  }

/** Save the Property's public display name alone; its colours stay as they are. */
export const savePropertyPublicDisplayName =
  (deps: Deps) =>
  async (
    input: Readonly<{ propertyId: string; displayName: string }>,
    ctx: AuthContext,
  ) => {
    assertPortalAdmin(ctx)
    const pid = propertyId(input.propertyId)
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
    return deps.experienceRepo.savePropertyDisplayName({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: pid,
      displayName: normalizedRequired(input.displayName, 'Display name', 120),
      updatedBy: ctx.userId,
      at: deps.clock(),
    })
  }

/**
 * A Property starts with its confirmed name as its public display name, so AI
 * reply drafts work before anyone opens its settings. A name the Property
 * already has is never replaced. Resolves whether one was set.
 */
export const ensureDefaultPublicDisplayName =
  (deps: Pick<Deps, 'experienceRepo' | 'idGen' | 'clock'>) =>
  async (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      displayName: string
    }>,
  ): Promise<boolean> => {
    const displayName = input.displayName.trim()
    if (displayName.length === 0 || displayName.length > 120) return false
    return deps.experienceRepo.ensurePropertyDisplayName({
      id: deps.idGen(),
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      displayName,
      at: deps.clock(),
    })
  }

export const savePropertyPortalBrandProfile =
  (deps: Deps) =>
  async (
    input: Readonly<{
      propertyId: string
      displayName: string
      logoUrl?: null
      defaultHeroImageUrl?: null
      primaryColor: string
      backgroundColor: string
      textColor: string
    }>,
    ctx: AuthContext,
  ) => {
    assertPortalAdmin(ctx)
    const pid = propertyId(input.propertyId)
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
    const displayName = normalizedRequired(input.displayName, 'Display name', 120)
    const textContrast = contrastRatio(input.textColor, input.backgroundColor)
    if (
      contrastRatio(input.primaryColor, input.backgroundColor) === null ||
      textContrast === null ||
      textContrast < 4.5
    ) {
      throw portalError(
        'invalid_theme',
        'Brand colours must be valid hex colours with accessible text contrast',
      )
    }
    return deps.experienceRepo.savePropertyProfile({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: pid,
      profile: {
        displayName,
        // Manager-supplied public URLs are deliberately not admitted. Image
        // issuance can populate these through the server-owned derivative path.
        logoUrl: null,
        defaultHeroImageUrl: null,
        primaryColor: input.primaryColor.toUpperCase(),
        backgroundColor: input.backgroundColor.toUpperCase(),
        textColor: input.textColor.toUpperCase(),
      },
      updatedBy: ctx.userId,
      at: deps.clock(),
    })
  }

export const savePropertyPortalBrandContent =
  (deps: Deps) =>
  async (
    input: Readonly<{
      propertyId: string
      locale: 'en' | 'bg'
      title: string
      shortDescription: string
    }>,
    ctx: AuthContext,
  ) => {
    assertPortalAdmin(ctx)
    const pid = propertyId(input.propertyId)
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
    return deps.experienceRepo.savePropertyContent({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: pid,
      locale: input.locale,
      content: {
        title: normalizedRequired(input.title, 'Guest title', 120),
        shortDescription: normalizedRequired(
          input.shortDescription,
          'Guest description',
          500,
        ),
      },
      updatedBy: ctx.userId,
      at: deps.clock(),
    })
  }

export const savePortalLocalizedOverride =
  (deps: Deps) =>
  async (
    input: Readonly<{
      portalId: string
      locale: 'en' | 'bg'
      title: string | null
      shortDescription: string | null
      heroImageUrl?: null
    }>,
    ctx: AuthContext,
  ) => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to change Portal guest content',
    })
    if (portal.publicationState === 'archived') {
      throw portalError('portal_inactive', 'Restore this Portal before changing content')
    }
    return deps.experienceRepo.savePortalOverride({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      locale: input.locale,
      override: {
        title:
          input.title === null
            ? null
            : normalizedRequired(input.title, 'Portal guest title', 120),
        shortDescription:
          input.shortDescription === null
            ? null
            : normalizedRequired(input.shortDescription, 'Portal guest description', 500),
        heroImageUrl: null,
      },
      updatedBy: ctx.userId,
      at: deps.clock(),
    })
  }
