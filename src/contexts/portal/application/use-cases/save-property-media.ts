// Portal context — put an uploaded photograph or logo on the Property look, move
// where the photograph is anchored, or take either off.
//
// The bytes arrive through the upload endpoint (ADR 0063), which answers with an
// asset id. This is the second step: pointing the Property's Brand Profile at
// that asset. The database ties the reference to an asset of the same
// Organization and Property but not to its purpose, so the purpose and the
// asset's state are checked here, and anything else is the same refusal as a
// missing image: a probe learns nothing about other tenants' images. Like the
// other look writers the profile write runs inside the Property's publication
// lock, so a name or colour write beside it is never put back.
//
// Only an Account Admin may (the look is shared by every Portal of the
// Property), and only while the Property's `portal.write` capability is on;
// taking an image off needs no `portal.upload`, so it keeps working if uploads
// are switched off.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { propertyId, type OrganizationId, type PropertyId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { portalError } from '../../domain/errors'
import type { PortalMediaReferenceSlot } from '../../domain/portal-media-asset'
import { normaliseFocalPoint, normaliseHeroAltText } from '../../domain/property-look'
import { assertPropertyAccess } from '../assert-property-access'
import { findReferencableMediaAsset } from '../referencable-media-asset'
import { resolvePropertyLookMedia } from '../property-look-media'
import type {
  PortalExperienceRepository,
  PropertyPortalBrandProfile,
} from '../ports/portal-experience.repository'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'

type Deps = Readonly<{
  experienceRepo: Pick<
    PortalExperienceRepository,
    'savePropertyHero' | 'savePropertyLogo'
  >
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

export type SavePropertyHeroInput = Readonly<{
  propertyId: string
  /** An uploaded photograph, or null to take the photograph off. */
  assetId: string | null
  /** Where pages crop around, 0 to 1; the middle when left out. */
  focalX?: number
  focalY?: number
  /** The photograph's description per language; null (or only spaces) clears it, a language left out keeps its own. */
  altTexts?: ReadonlyArray<Readonly<{ locale: OfferedGuestLocale; text: string | null }>>
}>

export type SavePropertyLogoInput = Readonly<{
  propertyId: string
  /** An uploaded logo, or null to take the logo off. */
  assetId: string | null
}>

const CENTRE = 0.5

function assertAdmin(ctx: AuthContext): void {
  if (!canForContext(ctx, 'portal.admin')) {
    throw portalError(
      'forbidden',
      'Only an Account Admin can change Property-wide Portal branding',
    )
  }
}

/** The asset a slot may point at, or the refusal a missing image gets. */
async function checkedAsset(
  deps: Pick<Deps, 'mediaRepo'>,
  organizationId: OrganizationId,
  pid: PropertyId,
  slot: PortalMediaReferenceSlot,
  assetId: string,
): Promise<string> {
  const asset = await findReferencableMediaAsset(
    deps.mediaRepo,
    organizationId,
    pid,
    slot,
    assetId,
  )
  if (!asset) throw portalError('media_not_found', 'image not found for this Property')
  return asset.id
}

/** Each language once (the last word stands), trimmed, bounded, an empty one meaning none. */
function normalisedAltTexts(input: SavePropertyHeroInput) {
  if (input.altTexts === undefined) return undefined
  const byLocale = new Map(
    input.altTexts.map(({ locale, text }) => [locale, normaliseHeroAltText(text)]),
  )
  return [...byLocale].map(([locale, text]) => ({ locale, text }))
}

/** The writer's answer: the profile and the media a page draws from it. A Property with no profile is asked to set its name first. */
async function answer(
  deps: Pick<Deps, 'mediaRepo'>,
  ctx: AuthContext,
  pid: PropertyId,
  profile: PropertyPortalBrandProfile | null,
) {
  if (!profile) {
    throw portalError(
      'brand_profile_missing',
      'Set the public display name before changing the look',
    )
  }
  const media = await resolvePropertyLookMedia(deps, ctx.organizationId, pid, profile)
  return { profile, media }
}

export const savePropertyHero =
  (deps: Deps) => async (input: SavePropertyHeroInput, ctx: AuthContext) => {
    assertAdmin(ctx)
    const pid = propertyId(input.propertyId)
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
    const altTexts = normalisedAltTexts(input)
    const focal = normaliseFocalPoint(input.focalX ?? CENTRE, input.focalY ?? CENTRE)
    const assetId =
      input.assetId === null
        ? null
        : await checkedAsset(deps, ctx.organizationId, pid, 'brand_hero', input.assetId)
    const profile = await deps.experienceRepo.savePropertyHero({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: pid,
      hero: assetId === null ? null : { assetId, focalX: focal.x, focalY: focal.y },
      ...(altTexts === undefined ? {} : { altTexts }),
      actorUserId: ctx.userId,
      at: deps.clock(),
    })
    return answer(deps, ctx, pid, profile)
  }

export const savePropertyLogo =
  (deps: Deps) => async (input: SavePropertyLogoInput, ctx: AuthContext) => {
    assertAdmin(ctx)
    const pid = propertyId(input.propertyId)
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
    const logoAssetId =
      input.assetId === null
        ? null
        : await checkedAsset(deps, ctx.organizationId, pid, 'brand_logo', input.assetId)
    const profile = await deps.experienceRepo.savePropertyLogo({
      organizationId: ctx.organizationId,
      propertyId: pid,
      logoAssetId,
      actorUserId: ctx.userId,
      at: deps.clock(),
    })
    return answer(deps, ctx, pid, profile)
  }
