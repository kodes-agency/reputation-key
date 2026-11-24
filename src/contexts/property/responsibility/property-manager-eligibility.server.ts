import type { IdentityManagerFactsPublicApi } from '#/contexts/identity/public-api'
import type { StaffPublicApi } from '#/contexts/identity/public-api'

export type PropertyManagerEligibilityDeps = Readonly<{
  identityPublicApi: IdentityManagerFactsPublicApi
  staffPublicApi: StaffPublicApi
}>

/** This context's Identity facts as the shared eligibility policy reads them. */
export const policyDeps = (deps: PropertyManagerEligibilityDeps) => ({
  listActiveManagers: deps.identityPublicApi.listActiveManagers,
  getAccessiblePropertyIds: deps.staffPublicApi.getAccessiblePropertyIds,
})
