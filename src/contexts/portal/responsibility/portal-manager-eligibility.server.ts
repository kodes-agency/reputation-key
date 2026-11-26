import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/public-api'
import type { StaffPublicApi } from '#/contexts/identity/public-api'

export type PortalManagerEligibilityDeps = Readonly<{
  identityPublicApi: IdentityManagerFactsPublicApi
  staffPublicApi: StaffPublicApi
}>

/** This context's Identity facts as the shared eligibility policy reads them. */
export const policyDeps = (deps: PortalManagerEligibilityDeps) => ({
  listActiveManagers: deps.identityPublicApi.listActiveManagers,
  getAccessiblePropertyIds: deps.staffPublicApi.getAccessiblePropertyIds,
})
