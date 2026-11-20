// Portal context — the Property look and guest-experience use cases, composed
// from one set of dependencies. Split from `build.ts` to keep that module under
// the file-length limit; every entry shares the same dependencies. A Portal's
// own look (ADR 0070) is composed here too, with its repository.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  getPropertyPortalExperience,
  savePortalLocalizedOverride,
  savePropertyDefaultGuestLocales,
  savePropertyPortalBrandContent,
  savePropertyPortalBrandProfile,
  savePropertyPublicDisplayName,
} from './editor/manage-portal-experience.server'
import {
  savePortalLookColours,
  savePortalLookIdentity,
} from './look/save-portal-look.server'
import { savePortalLookPhoto } from './look/save-portal-photo.server'
import { savePropertyLook } from './look/save-property-look.server'
import { savePropertyHero, savePropertyLogo } from './look/save-property-media.server'
import type { PortalMediaAssetRepository } from './media/portal-media-asset-repository.port.server'
import type { PortalExperienceRepository } from './editor/portal-experience-repository.port.server'
import type { PortalLookRepository } from './look/portal-look-repository.port.server'
import type { PortalRepository } from './publication/portal-repository.port.server'

type ExperienceDeps = Readonly<{
  experienceRepo: PortalExperienceRepository
  mediaRepo: PortalMediaAssetRepository
  portalRepo: PortalRepository
  /** A Portal's own look, one row per Portal that has one. */
  portalLookRepo: PortalLookRepository
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
}>

export const buildExperienceUseCases = (deps: ExperienceDeps) => ({
  getPropertyPortalExperience: getPropertyPortalExperience(deps),
  savePropertyPortalBrandProfile: savePropertyPortalBrandProfile(deps),
  savePropertyLook: savePropertyLook(deps),
  savePropertyHero: savePropertyHero(deps),
  savePropertyLogo: savePropertyLogo(deps),
  savePropertyPublicDisplayName: savePropertyPublicDisplayName(deps),
  savePropertyDefaultGuestLocales: savePropertyDefaultGuestLocales(deps),
  savePropertyPortalBrandContent: savePropertyPortalBrandContent(deps),
  savePortalLocalizedOverride: savePortalLocalizedOverride(deps),
  savePortalLookColours: savePortalLookColours(deps),
  savePortalLookIdentity: savePortalLookIdentity(deps),
  savePortalLookPhoto: savePortalLookPhoto(deps),
})
