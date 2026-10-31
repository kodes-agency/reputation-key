import { isReplyDraftingV2Binding } from './domain/reply-drafting-v2'
import { z } from 'zod/v4'
import { REPLY_BODY_RULES } from './domain/reply-body-lint-policy'
import { replyDraftingV2OptionsSchema } from './reply-drafting-v2-schema'

export const replyBodyIssueCodeSchema = z.enum(
  Object.keys(REPLY_BODY_RULES) as [
    keyof typeof REPLY_BODY_RULES,
    ...Array<keyof typeof REPLY_BODY_RULES>,
  ],
)
export const replyVoiceChoicesSchema = z
  .object({
    closing: z.number().int().min(-1).max(100),
    signOff: z.number().int().min(0).max(100),
    contactSentence: z.number().int().min(0).max(100),
    emoji: z.number().int().min(0).max(100),
    includeContact: z.boolean(),
  })
  .strict()

export const replyDraftingV2BindingSchema = z
  .object({
    options: replyDraftingV2OptionsSchema,
    voiceDigest: z.string().regex(/^[0-9a-f]{64}$/),
    generationSeed: z.string().regex(/^[0-9a-f]{64}$/),
    parentOperationId: z.uuid().nullable(),
    rewriteOrdinal: z.union([z.literal(0), z.literal(1)]),
    rewriteIssues: z
      .array(replyBodyIssueCodeSchema)
      .max(Object.keys(REPLY_BODY_RULES).length),
  })
  .strict()
  .refine(isReplyDraftingV2Binding, { message: 'Invalid reply drafting binding' })

export type ReplyVoiceChoices = z.infer<typeof replyVoiceChoicesSchema>
