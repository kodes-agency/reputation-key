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

import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { portalError } from '../domain/errors'
import type { PortalMediaReferenceSlot } from '../domain/portal-media-asset'
import { normaliseFocalPoint, normaliseHeroAltText } from '../domain/property-look'
import type { PortalMediaAssetRepository } from './ports/portal-media-asset.repository'
import { findReferencableMediaAsset } from './referencable-media-asset'

const CENTRE = 0.5

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
