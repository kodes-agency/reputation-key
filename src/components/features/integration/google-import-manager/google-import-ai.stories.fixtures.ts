// Story-only fixtures for the AI-analysis step of the import flow. Not a story
// file: the Storybook glob matches only a final `.stories.` segment, and the merchant AI snapshot shape is
// shared by the progress-view and manager stories.
import { fn } from 'storybook/test'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { MerchantAiSnapshot } from '#/contexts/identity/application/public-api'
import type { GoogleImportAiFns } from './google-import-manager-contract'

export const IMPORTED_PROPERTY_ID = '10000000-0000-4000-8000-000000000011'

const aiDisabled: MerchantAiSnapshot = {
  organizationId: 'org-story',
  propertyId: IMPORTED_PROPERTY_ID,
  state: 'disabled',
  authorizationLineageId: null,
  capabilities: [],
  capabilityRuntimeProfileVersions: {},
  capabilityEpochs: { review_analysis: 0, reply_drafting: 0, property_trends: 0 },
  authorizedSourceEpoch: 0,
  analysisStartSequence: 0,
  stateVersion: 0,
  noticeVersion: MERCHANT_AI_NOTICE.version,
  noticeDigest: MERCHANT_AI_NOTICE.digest,
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  routingPolicyVersion: 1,
  processingRegion: 'global',
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  redactionProfileFamily: 'gbp-review-global-v1',
}

export const aiEnabled: MerchantAiSnapshot = {
  ...aiDisabled,
  state: 'enabled',
  authorizationLineageId: '20000000-0000-4000-8000-000000000001',
  capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
  capabilityRuntimeProfileVersions: {
    review_analysis: 'review-analysis-runtime-v1',
    reply_drafting: 'reply-drafting-runtime-v1',
    property_trends: 'property-trends-runtime-v1',
  },
  capabilityEpochs: { review_analysis: 1, reply_drafting: 1, property_trends: 1 },
  authorizedSourceEpoch: 0,
  stateVersion: 1,
}

/** Server-fn doubles: the property starts without consent and enables on demand. */
export function createAiFnsFixture(
  initial: MerchantAiSnapshot | null = null,
): GoogleImportAiFns & {
  getMerchantAiAuthorization: ReturnType<typeof fn>
  enableMerchantAi: ReturnType<typeof fn>
} {
  const getMerchantAiAuthorization = fn(async () => ({
    authorization: initial,
    notice: MERCHANT_AI_NOTICE,
  }))
  const enableMerchantAi = fn(async () => aiEnabled)
  return {
    getMerchantAiAuthorization,
    enableMerchantAi,
  } as unknown as GoogleImportAiFns & {
    getMerchantAiAuthorization: ReturnType<typeof fn>
    enableMerchantAi: ReturnType<typeof fn>
  }
}
