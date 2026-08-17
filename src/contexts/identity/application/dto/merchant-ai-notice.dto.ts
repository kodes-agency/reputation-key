import {
  CURRENT_MERCHANT_AI_NOTICE,
  MERCHANT_AI_NOTICE_PAYLOAD,
  type MerchantAiNoticeCatalogueEntry,
} from '#/shared/merchant-ai-notice-contract'
import { AI_SOURCE_POLICY_ID_V1 } from '#/shared/ai-source-profile'

export {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'

export const MERCHANT_AI_SOURCE_POLICY_ID = AI_SOURCE_POLICY_ID_V1
export const MERCHANT_AI_REDACTION_PROFILE_FAMILY = 'gbp-review-global-v1' as const
export const MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION =
  'private-beta-global-v1' as const

export type MerchantAiNoticeDto = MerchantAiNoticeCatalogueEntry

export const MERCHANT_AI_NOTICE: MerchantAiNoticeDto = CURRENT_MERCHANT_AI_NOTICE

export { MERCHANT_AI_NOTICE_PAYLOAD }
