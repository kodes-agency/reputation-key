// The Property look and guest-experience wiring: every use case is built from
// the one set of dependencies, so the look save is composed alongside the rest.

import { describe, expect, it } from 'vitest'
import { buildExperienceUseCases } from './build-experience'
import { getDb } from '#/shared/db'
import { createPortalRepository } from './infrastructure/repositories/portal.repository'
import { createPortalLookRepository } from './infrastructure/repositories/portal-look.repository'
import type { PortalExperienceRepository } from './application/ports/portal-experience.repository'
import type { PortalMediaAssetRepository } from './application/ports/portal-media-asset.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

describe('buildExperienceUseCases', () => {
  it('composes the look save with the other experience use cases', () => {
    const useCases = buildExperienceUseCases({
      experienceRepo: {} as PortalExperienceRepository,
      mediaRepo: {} as PortalMediaAssetRepository,
      portalRepo: createPortalRepository(getDb()),
      portalLookRepo: createPortalLookRepository(getDb()),
      staffPublicApi: {} as StaffPublicApi,
      idGen: () => 'id',
      clock: () => new Date(0),
    })

    expect(Object.keys(useCases).sort()).toEqual(
      [
        'getPropertyPortalExperience',
        'savePortalLocalizedOverride',
        'savePortalLookColours',
        'savePortalLookIdentity',
        'savePortalLookPhoto',
        'savePropertyDefaultGuestLocales',
        'savePropertyHero',
        'savePropertyLogo',
        'savePropertyLook',
        'savePropertyPortalBrandContent',
        'savePropertyPortalBrandProfile',
        'savePropertyPublicDisplayName',
      ].sort(),
    )
    for (const useCase of Object.values(useCases)) {
      expect(typeof useCase).toBe('function')
    }
  })
})
