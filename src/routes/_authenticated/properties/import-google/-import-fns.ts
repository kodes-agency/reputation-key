// Resolve server-function bindings only when a route or component reads them.
// Eager object members can capture `undefined` when Vite splits a cyclic chunk.
import {
  cancelPropertyImportV2,
  getPropertyImportV2Status,
  listImportAccounts,
  listImportCandidates,
  recoverPropertyImportV2,
  renewImportAuthorizationLease,
  retryPropertyImportItem,
  startPropertyImportV2,
} from '#/contexts/integration/server/gbp-import'
import {
  getGoogleAuthUrl,
  listGoogleConnections,
} from '#/contexts/integration/server/google-connections'
import {
  deferMerchantAiDecisionFn,
  enableMerchantAiForPropertiesFn,
  getMerchantAiAuthorizationFn,
  listMerchantAiOverviewFn,
} from '#/contexts/identity/server/merchant-ai'
import { listMembers } from '#/contexts/identity/server/organizations'
import { listProperties, updateProperty } from '#/contexts/property/server/properties'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from '#/contexts/property/server/property-responsible-managers'
import { getReviewAnalysisProgressFn } from '#/contexts/ai/server/review-analysis'
import type {
  GoogleImportFns,
  GoogleImportSetupFns,
} from '#/components/features/integration/google-import-manager/google-import-manager-contract'

export const importFns: GoogleImportFns = {
  get getGoogleAuthUrl() {
    return getGoogleAuthUrl
  },
  get listGoogleConnections() {
    return listGoogleConnections
  },
  get listImportAccounts() {
    return listImportAccounts
  },
  get listImportCandidates() {
    return listImportCandidates
  },
  get renewImportAuthorizationLease() {
    return renewImportAuthorizationLease
  },
  get startPropertyImportV2() {
    return startPropertyImportV2
  },
  get recoverPropertyImportV2() {
    return recoverPropertyImportV2
  },
  get getPropertyImportV2Status() {
    return getPropertyImportV2Status
  },
  get retryPropertyImportItem() {
    return retryPropertyImportItem
  },
  get cancelPropertyImportV2() {
    return cancelPropertyImportV2
  },
}

export const importSetupFns: GoogleImportSetupFns = {
  get listProperties() {
    return listProperties
  },
  get listMembers() {
    return listMembers
  },
  get listPropertyResponsibleManagers() {
    return listPropertyResponsibleManagers
  },
  get listMerchantAiOverview() {
    return listMerchantAiOverviewFn
  },
  get getMerchantAiAuthorization() {
    return getMerchantAiAuthorizationFn
  },
  get getReviewAnalysisProgress() {
    return getReviewAnalysisProgressFn
  },
  get updateProperty() {
    return updateProperty
  },
  get updatePropertyResponsibleManagers() {
    return updatePropertyResponsibleManagers
  },
  get enableMerchantAiForProperties() {
    return enableMerchantAiForPropertiesFn
  },
  get deferMerchantAiDecision() {
    return deferMerchantAiDecisionFn
  },
}
