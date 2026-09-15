import type {
  deferMerchantAiDecisionFn,
  enableMerchantAiForPropertiesFn,
  getMerchantAiAuthorizationFn,
  listMerchantAiOverviewFn,
} from '#/contexts/identity/server/merchant-ai'
import type { listMembers } from '#/contexts/identity/server/organizations'
import type {
  listProperties,
  updateProperty,
} from '#/contexts/property/server/properties'
import type {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from '#/contexts/property/server/property-responsible-managers'
import type { getReviewAnalysisProgressFn } from '#/contexts/ai/server/review-analysis'
import type {
  getPropertyPortalExperience,
  savePropertyPublicDisplayName,
} from '#/contexts/portal/server/portals'

/**
 * The reads and writes of the "Set up properties" step. The route binds them
 * to the server functions, so the step itself never imports a server module.
 */
export type PropertySetupFns = Readonly<{
  listProperties: typeof listProperties
  listMembers: typeof listMembers
  listPropertyResponsibleManagers: typeof listPropertyResponsibleManagers
  listMerchantAiOverview: typeof listMerchantAiOverviewFn
  getMerchantAiAuthorization: typeof getMerchantAiAuthorizationFn
  getReviewAnalysisProgress: typeof getReviewAnalysisProgressFn
  getPropertyPortalExperience: typeof getPropertyPortalExperience
  savePropertyPublicDisplayName: typeof savePropertyPublicDisplayName
  updateProperty: typeof updateProperty
  updatePropertyResponsibleManagers: typeof updatePropertyResponsibleManagers
  enableMerchantAiForProperties: typeof enableMerchantAiForPropertiesFn
  deferMerchantAiDecision: typeof deferMerchantAiDecisionFn
}>

/** A property the import produced, as the import progress names it. */
export type SetupImportedProperty = Readonly<{ propertyId: string; propertyName: string }>

export type SetupMember = Readonly<{ userId: string; name: string; email: string }>
