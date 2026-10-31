// Whether a stored analysis still stands under the grant's notice. Split out of the
// output store adapter, which is past the file-length ratchet.
import { materiallyChangedMerchantAiCapabilities } from '#/shared/merchant-ai-notice-change'
import type { MerchantAiNoticeReference } from '#/shared/merchant-ai-notice-contract'

/**
 * Analysis stays deliverable across a notice that left Review Analysis unchanged
 * (ADR 0074), the rule settlement applies: a drafting-only renewal keeps the
 * history visible. No recorded notice, or an unknown one, withholds it.
 */
export function analysisNoticeStillCovers(
  analysis: Readonly<{
    operationNoticeVersion: string | null
    operationNoticeDigest: string | null
  }>,
  head: MerchantAiNoticeReference,
): boolean {
  const { operationNoticeVersion: noticeVersion, operationNoticeDigest: noticeDigest } =
    analysis
  if (noticeVersion === null || noticeDigest === null) return false
  return !materiallyChangedMerchantAiCapabilities(
    { noticeVersion, noticeDigest },
    head,
  ).includes('review_analysis')
}
