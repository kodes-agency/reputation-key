export type MerchantAiNoticeAnnouncement = Readonly<{
  title: string
  points: readonly string[]
}>

export const MERCHANT_AI_NOTICE_ANNOUNCEMENTS: Readonly<
  Record<string, MerchantAiNoticeAnnouncement>
> = {
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
