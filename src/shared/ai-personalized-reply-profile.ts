import { z } from 'zod/v4'

/** Browser-safe identity for the first genuine reply-draft profile. */
export const AI_PERSONALIZED_REPLY_PROFILE_VERSION = 'reply-draft-v2' as const

export const AI_PERSONALIZED_REPLY_LANGUAGES = Object.freeze([
  'en-Latn',
  'bg-Cyrl',
] as const)

export type PersonalizedReplyTone = 'professional' | 'friendly' | 'casual'

const groundingSchema = z
  .object({
    /** Exact excerpt from the current, redacted Review text. */
    sourceExcerpt: z.string().trim().min(2).max(160),
    /** Exact excerpt from the generated reply that the source supports. */
    replyExcerpt: z.string().trim().min(2).max(160),
  })
  .strict()

export const personalizedReplyDraftOutputSchema = z
  .object({
    languageCode: z.string().min(1).max(35),
    replyText: z.string().trim().min(24).max(1_200),
    grounding: z.array(groundingSchema).min(1).max(3),
  })
  .strict()

export type PersonalizedReplyDraft = z.infer<typeof personalizedReplyDraftOutputSchema>
