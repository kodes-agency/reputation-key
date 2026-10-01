// The Property look and guest-experience wiring: every use case is built from
// the one set of dependencies, so the look save is composed alongside the rest.

import { describe, expect, it } from 'vitest'
import { buildExperienceUseCases } from './build-experience'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import type { PortalExperienceRepository } from './application/ports/portal-experience.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

describe('buildExperienceUseCases', () => {
  it('composes the look save with the other experience use cases', () => {
    const useCases = buildExperienceUseCases({
      experienceRepo: {} as PortalExperienceRepository,
      portalRepo: createInMemoryPortalRepo(),
      staffPublicApi: {} as StaffPublicApi,
      idGen: () => 'id',
      clock: () => new Date(0),
    })

    expect(Object.keys(useCases).sort()).toEqual(
      [
        'getPropertyPortalExperience',
        'savePortalLocalizedOverride',
        'savePropertyDefaultGuestLocales',
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
