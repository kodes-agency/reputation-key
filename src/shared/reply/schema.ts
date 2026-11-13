import { z } from 'zod/v4'

/** Additive contract; v1 and all its readers retain reply-draft-v3. */
export const REPLY_DRAFTING_V2_VERSIONS = Object.freeze({
  operation: 'reply-suggestion-v2',
  profile: 'reply-draft-v4',
  runtime: 'reply-drafting-runtime-v2',
  prompt: 'reply-suggestion-prompt-v2',
  provenance: 'ai-reply-provenance-v4',
} as const)

export const REPLY_DRAFTING_V2_LANGUAGES = ['en-Latn', 'es-Latn', 'bg-Cyrl'] as const
// Serving selection is independent of the immutable contract/history catalogue.
// Owner can withdraw Spanish by removing es-Latn on this line alone.
export const REPLY_DRAFTING_V2_SERVED_LANGUAGES = [
  'en-Latn',
  'es-Latn',
  'bg-Cyrl',
] as const
const REPLY_DRAFTING_V2_CASES = [
  'praise',
  'praise_with_issue',
  'mixed',
  'complaint',
  'serious',
  'money',
  'unclear',
] as const

/** Property insertion order is also the provider's strict output order. */
export const replyDraftingV2OutputSchema = z
  .object({
    languageCode: z.string().min(1).max(35),
    case: z.enum(REPLY_DRAFTING_V2_CASES),
    mainPoint: z.array(z.number().int().positive().safe()).min(1).max(2),
    avoidTerms: z.array(z.string().trim().min(2).max(40)).max(8),
    replyText: z.string().trim().min(24).max(1_200),
  })
  .strict()

export type ReplyDraftingV2Output = z.infer<typeof replyDraftingV2OutputSchema>

export const replyDraftingV2OptionsSchema = z
  .object({
    variation: z.number().int().nonnegative().safe(),
    length: z.enum(['standard', 'short']),
    maxWords: z.number().int().min(8).max(80).optional(),
    opening: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    apologyStart: z.string().min(1).max(40),
  })
  .strict()
  .refine((v) => v.maxWords === undefined || v.length === 'short')

export type ReplyDraftingV2Options = z.infer<typeof replyDraftingV2OptionsSchema>
