// Portal context — the Property look and guest-experience use cases, composed
// from one set of dependencies. Split from `build.ts` to keep that module under
// the file-length limit; every entry shares the same dependencies. A Portal's
// own look (ADR 0070) is composed here too, with its repository and switch.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  getPropertyPortalExperience,
  savePortalLocalizedOverride,
  savePropertyDefaultGuestLocales,
  savePropertyPortalBrandContent,
  savePropertyPortalBrandProfile,
  savePropertyPublicDisplayName,
} from './application/use-cases/manage-portal-experience'
import {
  savePortalLookColours,
  savePortalLookIdentity,
} from './application/use-cases/save-portal-look'
import { savePortalLookPhoto } from './application/use-cases/save-portal-photo'
import { savePropertyLook } from './application/use-cases/save-property-look'
import {
  savePropertyHero,
  savePropertyLogo,
} from './application/use-cases/save-property-media'
import type { PortalMediaAssetRepository } from './application/ports/portal-media-asset.repository'
import type { PortalExperienceRepository } from './application/ports/portal-experience.repository'
import type { PortalLookRepository } from './application/ports/portal-look.repository'
import type { PortalRepository } from './application/ports/portal.repository'

type ExperienceDeps = Readonly<{
  experienceRepo: PortalExperienceRepository
  mediaRepo: PortalMediaAssetRepository
  portalRepo: PortalRepository
  /** A Portal's own look, one row per Portal that has one. */
  portalLookRepo: PortalLookRepository
  staffPublicApi: StaffPublicApi
  idGen: () => string
  clock: () => Date
  /** PORTAL_OWN_LOOK_ENABLED: whether a Portal's own look may be changed. */
  portalOwnLookEnabled: boolean
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
