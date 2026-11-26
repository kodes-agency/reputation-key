import {
  CURRENT_MERCHANT_AI_NOTICE,
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_PAYLOAD,
  MERCHANT_AI_NOTICE_VERSION,
  type MerchantAiNoticeCatalogueEntry,
} from '#/shared/merchant-ai-notice-contract'
import { AI_SOURCE_POLICY_ID_V1 } from '#/shared/ai-review-source/ai-source-profile'

export {
  isMerchantAiNoticeInForceForCapabilities,
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'

export const MERCHANT_AI_SOURCE_POLICY_ID = AI_SOURCE_POLICY_ID_V1
export const MERCHANT_AI_REDACTION_PROFILE_FAMILY = 'gbp-review-global-v1' as const
// The provider deployment profile a consent is recorded under: the one this build
// serves (`ai-provider-deployment-profile.ts`). Spelled out here because this module
// ships to the browser; a test holds it equal to the profile.
export const MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION =
  'private-beta-global-v2' as const

/** What every consent this build records is granted under. */
export const MERCHANT_AI_GRANT_POLICY = {
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  sourcePolicyId: MERCHANT_AI_SOURCE_POLICY_ID,
  routingPolicyVersion: 1,
  providerDeploymentProfileVersion: MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
  redactionProfileFamily: MERCHANT_AI_REDACTION_PROFILE_FAMILY,
} as const

export type MerchantAiNoticeDto = MerchantAiNoticeCatalogueEntry

export const MERCHANT_AI_NOTICE: MerchantAiNoticeDto = CURRENT_MERCHANT_AI_NOTICE

export { MERCHANT_AI_NOTICE_PAYLOAD }
