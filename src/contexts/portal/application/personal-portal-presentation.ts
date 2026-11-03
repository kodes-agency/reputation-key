import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { printFinalOpeningWording } from '#/shared/domain/portal-print-final-wording'
import { PRINT_FINAL_COPY } from '#/shared/domain/portal-print-final-copy'
import { PRINT_FINAL_SCAN_CUE } from '#/shared/domain/portal-print-final-cue'
import type { Portal } from '../domain/types'
import type { PortalExperienceRepository } from './ports/portal-experience.repository'
import type { PortalMediaAssetRepository } from './ports/portal-media-asset.repository'
import { resolvePropertyLookMedia } from './property-look-media'
import {
  DEFAULT_PORTAL_ACCENT,
  DEFAULT_PORTAL_FIELD,
  fieldColourOf,
} from '../domain/portal-publication-source'
import type { PortalPublicationRepository } from './ports/portal-publication.repository'
import type { PortalPrintWordingRepository } from './ports/portal-print-wording.repository'
import type { PortalLastPrintRepository } from './ports/portal-last-print.repository'
import { presentImmersiveBrand, type ServableMediaUrls } from './public-portal-immersive'
import type { ImmersiveBrandProfile } from '../domain/portal-publication-snapshot'
import type { PublicImmersiveExperience } from './public-api'

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
  finalKitEnabled: boolean
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
  const [saved, last] = deps.finalKitEnabled
    ? await Promise.all([
        deps.wordingRepo.find(portal.organizationId, portal.id),
        deps.lastPrintRepo.find(portal.organizationId, portal.id),
      ])
    : [null, null]
  const wording = printFinalOpeningWording(saved, last?.settings ?? null)
  const copy = PRINT_FINAL_COPY[locale][wording.callToAction]
  const own = wording.customWords?.[locale]
  return {
    headline: own?.headline ?? copy.headline,
    subline: own ? (own.subline ?? '') : copy.subline,
    cue: PRINT_FINAL_SCAN_CUE[locale],
  }
}
