// Test-only: a Property with wording and a published source Portal, for the use
// cases that give a person's guest page its content. Not imported by production code.
import type { CreatePersonalPortalDeps } from '#/contexts/portal/application/use-cases/create-personal-portal'
import { publicationSource } from '#/contexts/portal/domain/__fixtures__/publication-source'
import { buildPortalPublicationSnapshot } from '#/contexts/portal/application/portal-publication-snapshot'
import { setupCreatePortal, PROPERTY } from './portal-create-setup'
import { buildTestAuthContext } from './fixtures'

export const ctx = buildTestAuthContext()
export const reserved = '12345678-abcd-4000-8000-000000000001'
export function setup() {
  const state = setupCreatePortal({ propertyLookVersion: 1 })
  const source = publicationSource()
  const snapshot = buildPortalPublicationSnapshot({
    id: 'snapshot',
    portalId: source.portal.id,
    organizationId: source.organizationId,
    propertyId: source.propertyId,
    version: 1,
    source,
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=harbor',
      retrievedAt: new Date(),
      sourceEpoch: 1,
      profileVersion: 1,
    },
    createdBy: 'manager',
    createdAt: new Date(),
  })
  const deps = {
    ...state.optionsDeps,
    propertyApi: {
      ...state.optionsDeps.propertyApi,
      getPropertyTimezones: async () => [{ id: PROPERTY, timezone: 'Europe/Sofia' }],
    },
    propertyLifecycleApi: { isPropertyActive: async () => true },
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => ({
        state: 'verified' as const,
        uri: 'https://search.google.com/local/writereview?placeid=harbor',
        retrievedAt: new Date(),
        sourceEpoch: 1,
        profileVersion: 1,
      }),
    },
    managerRepo: { listActive: async () => [] },
    printWordingRepo: { find: async () => null },
    lastPrintRepo: { find: async () => null },
    addressRecoverable: true,
    checkGroupTarget: async () => {},
    publicationRepo: {
      loadWorkingCopy: async () => source,
      findActiveForPortal: async () => snapshot,
    },
    experienceRepo: {
      ...state.optionsDeps.experienceRepo,
      getPropertyExperience: async () => ({
        profile: {
          ...(
            await (
              state.optionsDeps.experienceRepo
                .getPropertyExperience as CreatePersonalPortalDeps['experienceRepo']['getPropertyExperience']
            )(ctx.organizationId, PROPERTY)
          ).profile!,
          displayName: 'Harbor',
        },
        content: [
          {
            id: 'wording',
            organizationId: ctx.organizationId,
            propertyId: PROPERTY,
            locale: 'en' as const,
            title: 'Welcome',
            shortDescription: 'Tell us about your visit.',
            heroAltText: null,
            version: 1,
            updatedBy: ctx.userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    },
  }
  return { state, deps, source }
}
