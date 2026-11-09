import {
  cancelPropertyImportV2,
  getPropertyImportV2Status,
  listImportAccounts,
  listImportCandidates,
  recoverPropertyImportV2,
  retryPropertyImportItem,
  startPropertyImportV2,
} from '#/contexts/integration/server/gbp-import'
import { getGoogleAuthUrl } from '#/contexts/integration/server/google-connections'
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
import {
  getPropertyPortalExperience,
  savePropertyPublicDisplayName,
} from '#/contexts/portal/server/portals'
import type {
  GoogleImportFns,
  GoogleImportSetupFns,
} from '#/contexts/integration/imports/ui/google-import-manager-contract'
import { getPropertySetupFn } from '#/contexts/reporting/server/property-setup'
import {
  getReplyLibraryFn,
  saveReplyVoiceFn,
} from '#/contexts/review/server/reply-library'

export const importFns: GoogleImportFns = {
  getGoogleAuthUrl,
  listImportAccounts,
  listImportCandidates,
  startPropertyImportV2,
  recoverPropertyImportV2,
  getPropertyImportV2Status,
  retryPropertyImportItem,
  cancelPropertyImportV2,
}

export const importReplySetupFns: GoogleImportSetupFns = {
  listProperties,
  listMembers,
  listPropertyResponsibleManagers,
  listMerchantAiOverview: listMerchantAiOverviewFn,
  getMerchantAiAuthorization: getMerchantAiAuthorizationFn,
  getReviewAnalysisProgress: getReviewAnalysisProgressFn,
  getPropertyPortalExperience,
  savePropertyPublicDisplayName,
  updateProperty,
  updatePropertyResponsibleManagers,
  enableMerchantAiForProperties: enableMerchantAiForPropertiesFn,
  deferMerchantAiDecision: deferMerchantAiDecisionFn,
  getPropertySetup: getPropertySetupFn,
  getReplyLibrary: getReplyLibraryFn,
  saveReplyVoice: saveReplyVoiceFn,
}
