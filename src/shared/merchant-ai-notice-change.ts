import {
  MERCHANT_AI_NOTICE_CHANGES,
  type MerchantAiNoticeChange,
  type MerchantAiNoticeReference,
} from './merchant-ai-notice-contract'
import {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiCapability,
} from './domain/merchant-ai-capability'

const sameNotice = (left: MerchantAiNoticeReference, right: MerchantAiNoticeReference) =>
  left.noticeVersion === right.noticeVersion && left.noticeDigest === right.noticeDigest

/** Union every intervening material change, including when a Property skips notices.
 * Unknown ancestry/digests conservatively invalidate every capability. */
export function materiallyChangedMerchantAiCapabilities(
  previous: MerchantAiNoticeReference,
  next: MerchantAiNoticeReference,
  changes: ReadonlyArray<MerchantAiNoticeChange> = MERCHANT_AI_NOTICE_CHANGES,
): ReadonlyArray<MerchantAiCapability> {
  const affected = new Set<MerchantAiCapability>()
  const seen = new Set<string>()
  let cursor = next
  while (!sameNotice(previous, cursor)) {
    const key = `${cursor.noticeVersion}:${cursor.noticeDigest}`
    if (seen.has(key)) return CURRENT_MERCHANT_AI_CAPABILITIES
    seen.add(key)
    const change = changes.find((entry) => sameNotice(entry, cursor))
    if (!change || !change.replaces) return CURRENT_MERCHANT_AI_CAPABILITIES
    for (const capability of change.materiallyChanges) affected.add(capability)
    cursor = change.replaces
  }
  return CURRENT_MERCHANT_AI_CAPABILITIES.filter((capability) => affected.has(capability))
}
