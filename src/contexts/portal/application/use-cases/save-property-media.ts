// Portal context — put an uploaded photograph or logo on the Property look, move
// where the photograph is anchored, or take either off.
//
// The bytes arrive through the upload endpoint (ADR 0063), which answers with an
// asset id. This is the second step: pointing the Property's Brand Profile at
// that asset. The purpose and the asset's state are checked by the rules a
// Portal's own photo and logo share (look-media-rules.ts). Like the
// other look writers the profile write runs inside the Property's publication
// lock, so a name or colour write beside it is never put back.
//
// Only an Account Admin may (the look is shared by every Portal of the
// Property), and only while the Property's `portal.write` capability is on;
// taking an image off needs no `portal.upload`, so it keeps working if uploads
// are switched off.

import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { portalError } from '../../domain/errors'
import { assertPropertyAccess } from '../assert-property-access'
import {
  checkedAsset,
  givenFocalPoint,
  normalisedAltTexts,
  type HeroAltTextInput,
} from '../look-media-rules'
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
  /** Where pages crop around, 0 to 1; left out, a photograph already on the look keeps its anchor and a new one is centred. */
  focalX?: number
  focalY?: number
  /** The photograph's description per language; null (or only spaces) clears it, a language left out keeps its own. */
  altTexts?: ReadonlyArray<HeroAltTextInput>
}>

export type SavePropertyLogoInput = Readonly<{
  propertyId: string
  /** An uploaded logo, or null to take the logo off. */
  assetId: string | null
}>

function assertAdmin(ctx: AuthContext): void {
  if (!canForContext(ctx, 'portal.admin')) {
    throw portalError(
      'forbidden',
      'Only an Account Admin can change Property-wide Portal branding',
    )
  }
}

/** Each language's description with its own row id: they are inserted side by side. */
function altTextRows(input: SavePropertyHeroInput, idGen: () => string) {
  if (input.altTexts === undefined) return undefined
  return [...normalisedAltTexts(input.altTexts)].map(([locale, text]) => ({
    id: idGen(),
    locale,
    text,
  }))
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
    const altTexts = altTextRows(input, deps.idGen)
    const focal = givenFocalPoint(input)
    const assetId =
      input.assetId === null
        ? null
        : await checkedAsset(
            deps.mediaRepo,
            ctx.organizationId,
            pid,
            'brand_hero',
            input.assetId,
          )
    const profile = await deps.experienceRepo.savePropertyHero({
      organizationId: ctx.organizationId,
      propertyId: pid,
      hero: assetId === null ? null : { assetId, ...focal },
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
        : await checkedAsset(
            deps.mediaRepo,
            ctx.organizationId,
            pid,
            'brand_logo',
            input.assetId,
          )
    const profile = await deps.experienceRepo.savePropertyLogo({
      organizationId: ctx.organizationId,
      propertyId: pid,
      logoAssetId,
      actorUserId: ctx.userId,
      at: deps.clock(),
    })
    return answer(deps, ctx, pid, profile)
  }
