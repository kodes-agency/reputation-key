// Portal context — the image rules every look writer shares: the Property
// look's photo and logo and a Portal's own (ADR 0070).
//
// The database ties a reference to an asset of the same Organization and
// Property but not to its purpose, so the purpose and the asset's state are
// checked here, and anything else is the same refusal as a missing image: a
// probe learns nothing about other tenants' images. A photo's description is
// held to one rule wherever it is written: each language once (the last word
// stands), trimmed, at most 160 characters, an empty one meaning none. A focal
// point given in part has its missing half in the middle.

import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../domain/errors'
import type { PortalMediaReferenceSlot } from '../domain/portal-media-asset'
import { normaliseFocalPoint, normaliseHeroAltText } from '../domain/property-look'
import type { PortalMediaAssetRepository } from '../media/portal-media-asset-repository.port.server'
import { findReferencableMediaAsset } from '../media/referencable-media-asset.server'
import { assertPropertyAccess } from '../publication/assert-property-access.server'

const CENTRE = 0.5

/** A Property with no Brand Profile is asked to set its public display name first. */
export function brandProfileMissing() {
  return portalError(
    'brand_profile_missing',
    'Set the public display name before changing the look',
  )
}

/** Who may write the Property-wide look: an Account Admin with update access to that Property. */
export async function authorizePropertyLookWrite(
  deps: Readonly<{ staffPublicApi: StaffPublicApi }>,
  ctx: AuthContext,
  rawPropertyId: string,
): Promise<PropertyId> {
  if (!canForContext(ctx, 'portal.admin')) {
    throw portalError(
      'forbidden',
      'Only an Account Admin can change Property-wide Portal branding',
    )
  }
  const pid = toPropertyId(rawPropertyId)
  await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
  return pid
}

/** The asset a slot may point at, or the refusal a missing image gets. */
export async function checkedAsset(
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  slot: PortalMediaReferenceSlot,
  assetId: string,
): Promise<string> {
  const asset = await findReferencableMediaAsset(
    mediaRepo,
    organizationId,
    propertyId,
    slot,
    assetId,
  )
  if (!asset) throw portalError('media_not_found', 'image not found for this Property')
  return asset.id
}

export type HeroAltTextInput = Readonly<{
  locale: OfferedGuestLocale
  text: string | null
}>

/** Each language's description once (the last word stands), normalised; null means none. */
export function normalisedAltTexts(
  altTexts: ReadonlyArray<HeroAltTextInput>,
): ReadonlyMap<OfferedGuestLocale, string | null> {
  return new Map(
    altTexts.map(({ locale, text }) => [locale, normaliseHeroAltText(text)] as const),
  )
}

/** A focal point only when one was given (a missing half is the middle); otherwise the writer decides. */
export function givenFocalPoint(
  input: Readonly<{ focalX?: number; focalY?: number }>,
): Readonly<{ focalX?: number; focalY?: number }> {
  if (input.focalX === undefined && input.focalY === undefined) return {}
  const { x, y } = normaliseFocalPoint(input.focalX ?? CENTRE, input.focalY ?? CENTRE)
  return { focalX: x, focalY: y }
}
