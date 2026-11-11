import { z } from 'zod/v4'

export const merchantAiNoticeUpdateSeenInputSchema = z.object({
  noticeVersion: z.string().min(1).max(100),
  noticeDigest: z.string().regex(/^[0-9a-f]{64}$/),
})
