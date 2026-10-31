// The shell's lazy AI-announcement chunk imports Start server functions. Keep
// createServerFn/composition out of the browser preview, as for reply templates.
import { MERCHANT_AI_NOTICE_ANNOUNCEMENTS } from '../../src/shared/merchant-ai-notice-announcements'
export const getMerchantAiNoticeUpdateFn = async () => ({
  ...MERCHANT_AI_NOTICE_ANNOUNCEMENTS['merchant-ai-notice-2026-10-30.v1']!,
  noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
  noticeDigest: 'a'.repeat(64),
  renewedAt: '2026-10-31T09:00:00.000Z',
})
export const markMerchantAiNoticeUpdateSeenFn = async (): Promise<void> => {}
