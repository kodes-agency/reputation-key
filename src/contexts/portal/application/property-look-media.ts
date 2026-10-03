// Portal context — the photograph and logo of a Property's look, as a reader
// shows them (the Property look page and the draft preview).
//
// The Brand Profile names its images by asset id. What is shown is the asset
// itself: its size, its address on the app's own origin, and only while it is
// the right purpose, of this Property and still servable. A taken-down image
// reads as no image, exactly as a published page falls back to its no-photo
// look. An image is never shown from an address a manager typed.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { portalMediaAssetId } from '#/shared/domain/ids'
import { portalMediaPublicPath } from '#/shared/domain/portal-media'
import {
  canReferencePortalMediaAsset,
  type PortalMediaReferenceSlot,
} from '../domain/portal-media-asset'
import type { PortalMediaAssetRepository } from './ports/portal-media-asset.repository'
import type { PropertyPortalBrandProfile } from './ports/portal-experience.repository'

export type PropertyLookHero = Readonly<{
  assetId: string
  /** The app's own media route for the asset. */
  url: string
  width: number
  height: number
  /** Where the page crops around: 0 to 1 across and down. */
  focalX: number
  focalY: number
}>

export type PropertyLookLogo = Readonly<{
  assetId: string
  url: string
  width: number
  height: number
}>

export type PropertyLookMedia = Readonly<{
  hero: PropertyLookHero | null
  logo: PropertyLookLogo | null
}>

export const NO_PROPERTY_LOOK_MEDIA: PropertyLookMedia = { hero: null, logo: null }

type MediaProfile = Pick<
  PropertyPortalBrandProfile,
  'heroAssetId' | 'heroFocalX' | 'heroFocalY' | 'logoAssetId'
>

type Deps = Readonly<{ mediaRepo: Pick<PortalMediaAssetRepository, 'findById'> }>

async function servableAsset(
  deps: Deps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  slot: PortalMediaReferenceSlot,
  assetId: string | null,
) {
  if (assetId === null) return null
  const asset = await deps.mediaRepo.findById(organizationId, portalMediaAssetId(assetId))
  if (!asset || asset.propertyId !== propertyId) return null
  return canReferencePortalMediaAsset(slot, asset) ? asset : null
}

export async function resolvePropertyLookMedia(
  deps: Deps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  profile: MediaProfile | null,
): Promise<PropertyLookMedia> {
  if (profile === null) return NO_PROPERTY_LOOK_MEDIA
  const [heroAsset, logoAsset] = await Promise.all([
    servableAsset(deps, organizationId, propertyId, 'brand_hero', profile.heroAssetId),
    servableAsset(deps, organizationId, propertyId, 'brand_logo', profile.logoAssetId),
  ])
  const { heroFocalX, heroFocalY } = profile
  return {
    hero:
      heroAsset && heroFocalX !== null && heroFocalY !== null
        ? {
            assetId: heroAsset.id,
            url: portalMediaPublicPath(heroAsset.id),
            width: heroAsset.width,
            height: heroAsset.height,
            focalX: heroFocalX,
            focalY: heroFocalY,
          }
        : null,
    logo: logoAsset
      ? {
          assetId: logoAsset.id,
          url: portalMediaPublicPath(logoAsset.id),
          width: logoAsset.width,
          height: logoAsset.height,
        }
      : null,
  }
}
