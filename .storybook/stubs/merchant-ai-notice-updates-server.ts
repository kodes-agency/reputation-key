// The shell's lazy AI-announcement chunk imports Start server functions. Keep
// createServerFn/composition out of the browser preview, as for reply templates.
// The shapes are the real server functions': `get` answers the AccountAdmin's
// unseen update or null, `markSeen` takes `{ data: { noticeVersion, noticeDigest } }`.
import { MERCHANT_AI_NOTICE_ANNOUNCEMENTS } from '../../src/shared/merchant-ai-notice-announcements'
import type { MerchantAiNoticeUpdate } from '../../src/shared/merchant-ai-notice-announcements'

const VERSION = 'merchant-ai-notice-2026-10-30.v1'

export const storyAiNoticeUpdate: MerchantAiNoticeUpdate = {
  ...MERCHANT_AI_NOTICE_ANNOUNCEMENTS[VERSION]!,
  noticeVersion: VERSION,
  noticeDigest: 'a'.repeat(64),
  renewedAt: '2026-10-31T09:00:00.000Z',
}

export const aiNoticeStoryState = {
  /** Whether the server still holds an unseen update for the person. */
  pending: true,
  /** What the page told the server it had seen, in order. */
  marked: [] as { noticeVersion: string; noticeDigest: string }[],
  /** How many times the page asked for the update. */
  reads: 0,
}

export const getMerchantAiNoticeUpdateFn =
  async (): Promise<MerchantAiNoticeUpdate | null> => {
    aiNoticeStoryState.reads += 1
    return aiNoticeStoryState.pending ? storyAiNoticeUpdate : null
  }

export const markMerchantAiNoticeUpdateSeenFn = async ({
  data,
}: {
  data: { noticeVersion: string; noticeDigest: string }
}): Promise<void> => {
  aiNoticeStoryState.marked.push(data)
  aiNoticeStoryState.pending = false
}
