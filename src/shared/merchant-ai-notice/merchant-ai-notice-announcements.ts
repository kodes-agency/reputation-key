export type MerchantAiNoticeAnnouncement = Readonly<{
  title: string
  points: readonly string[]
}>

export const MERCHANT_AI_NOTICE_ANNOUNCEMENTS: Readonly<
  Record<string, MerchantAiNoticeAnnouncement>
> = {
  'merchant-ai-notice-2026-11-06.v2': {
    title: 'Property Trends retired',
    points: [
      'Daily Property Trends are no longer generated.',
      'Guest voice summaries, review analysis and reply drafting remain available.',
      'Your existing analysis results and reply drafts are unchanged by this retirement.',
    ],
  },
  'merchant-ai-notice-2026-11-06.v1': {
    title: 'AI data-use notice corrected',
    points: [
      'Review analysis does not keep separate daily counts of reviews by star rating.',
      'Quality checks use an offline scorer on test material or recorded answers, without sending reviews to an AI provider.',
      'Analysis results expire after 730 days and are deleted by daily cleanup. The stored business category is excepted.',
      'Existing AI choices carry over automatically. You can turn them off at any time in AI settings.',
    ],
  },
  'merchant-ai-notice-2026-11-01.v1': {
    title: 'AI reply drafts got better',
    points: [
      "Drafts now answer what the guest said, framed by your property's own greeting and sign-off.",
      'A draft may be prepared as soon as you open a review, so it is ready when you ask for it.',
      'While a draft is written you can see each step, keep working, or press Stop.',
      'New Shorter, Tone and Try again buttons, and drafts in Spanish too.',
    ],
  },
  'merchant-ai-notice-2026-10-30.v1': {
    title: 'AI review insights got an upgrade',
    points: [
      'Guest voice now sorts what guests say into clear topics, with the cause behind each problem.',
      'A serious concern, such as safety or discrimination, can now raise an Urgent alert.',
      'We now name Anthropic as a second AI provider next to OpenAI. Today only OpenAI is used.',
      'Past reviews are read again, so topics and counts can shift for a short while.',
    ],
  },
}

export type MerchantAiNoticeUpdate = MerchantAiNoticeAnnouncement &
  Readonly<{
    noticeVersion: string
    noticeDigest: string
    renewedAt: string
  }>

/**
 * The two server calls behind the pending update, handed to components by the
 * route layer (a component never imports a server module). The settings banner
 * and What's new read and mark the same update through them.
 */
export type MerchantAiNoticeUpdateClient = Readonly<{
  get: () => Promise<MerchantAiNoticeUpdate | null>
  markSeen: (input: {
    data: { noticeVersion: string; noticeDigest: string }
  }) => Promise<void>
}>
export type MerchantAiNoticeUpdateClientGetter =
  () => Promise<MerchantAiNoticeUpdateClient>
