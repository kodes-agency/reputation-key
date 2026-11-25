import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { printOpeningWording } from '#/shared/domain/portal-print-wording'
import { PRINT_COPY } from '#/shared/domain/portal-print-copy'
import { PRINT_SCAN_CUE } from '#/shared/domain/portal-print-cue'
import type { Portal } from '../domain/types'
import type { PortalExperienceRepository } from '../editor/portal-experience-repository.port.server'
import type { PortalMediaAssetRepository } from '../media/portal-media-asset-repository.port.server'
import { resolvePropertyLookMedia } from '../look/property-look-media.server'
import {
  DEFAULT_PORTAL_ACCENT,
  DEFAULT_PORTAL_FIELD,
  fieldColourOf,
} from '../domain/portal-publication-source'
import type { PortalPublicationRepository } from '../publication/portal-publication-repository.port.server'
import type { PortalPrintWordingRepository } from '../printing/portal-print-wording-repository.port.server'
import type { PortalLastPrintRepository } from '../printing/portal-last-print-repository.port.server'
import {
  presentImmersiveBrand,
  type ServableMediaUrls,
} from '../publication/public-portal-immersive.server'
import type { ImmersiveBrandProfile } from '../domain/portal-publication-snapshot'
import type { PublicImmersiveExperience } from '../public-api'

export type PersonalPortalPresentationDeps = Readonly<{
  publicationRepo: Pick<PortalPublicationRepository, 'findActiveForPortal'>
  experienceRepo: Pick<PortalExperienceRepository, 'getPropertyExperience'>
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  mediaUrls: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    ids: readonly string[],
  ) => Promise<ServableMediaUrls>
  wordingRepo: Pick<PortalPrintWordingRepository, 'find'>
  lastPrintRepo: Pick<PortalLastPrintRepository, 'find'>
}>

export async function personalPortalLook(
  deps: PersonalPortalPresentationDeps,
  portal: Portal,
): Promise<PublicImmersiveExperience['brand']> {
  const live =
    portal.publicationState === 'published'
      ? await deps.publicationRepo.findActiveForPortal(portal.organizationId, portal.id)
      : null
  const configuration = live?.configuration
  const brand =
    configuration?.schemaVersion === 3
      ? configuration.brandProfile
      : await propertyPersonalBrand(deps, portal)
  const ids = [brand.logo?.assetId, brand.hero?.assetId].filter((id): id is string =>
    Boolean(id),
  )
  const urls = await deps.mediaUrls(portal.organizationId, portal.propertyId, ids)
  return presentImmersiveBrand(brand, urls)
}

async function propertyPersonalBrand(
  deps: PersonalPortalPresentationDeps,
  portal: Portal,
): Promise<ImmersiveBrandProfile> {
  const { profile } = await deps.experienceRepo.getPropertyExperience(
    portal.organizationId,
    portal.propertyId,
  )
  const media = await resolvePropertyLookMedia(
    deps,
    portal.organizationId,
    portal.propertyId,
    profile,
  )
  return {
    displayName: profile?.displayName ?? '',
    wordmark: profile?.wordmark ?? null,
    accentColour: profile?.primaryColor ?? DEFAULT_PORTAL_ACCENT,
    fieldColour: profile
      ? fieldColourOf(
          profile.backgroundMode,
          profile.backgroundColor,
          profile.primaryColor,
        )
      : DEFAULT_PORTAL_FIELD,
    logo: media.logo,
    hero: media.hero,
    lookVersion: profile?.lookVersion ?? 1,
  }
}

/** The words of the person's Pass: the print's wording, and the print's scan cue. */
export async function personalPortalWords(
  deps: PersonalPortalPresentationDeps,
  portal: Portal,
  locale: GuestLocale,
) {
  const [saved, last] = await Promise.all([
    deps.wordingRepo.find(portal.organizationId, portal.id),
    deps.lastPrintRepo.find(portal.organizationId, portal.id),
  ])
  const wording = printOpeningWording(saved, last?.settings ?? null)
  const copy = PRINT_COPY[locale][wording.callToAction]
  const own = wording.customWords?.[locale]
  return {
    headline: own?.headline ?? copy.headline,
    subline: own ? (own.subline ?? '') : copy.subline,
    cue: PRINT_SCAN_CUE[locale],
  }
}
