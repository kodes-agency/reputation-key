import { z } from 'zod/v4'
import { replyVoiceChoicesSchema } from './reply-drafting-v2-binding'

export const replyDraftingV2FrameSchema = z
  .object({
    voiceDigest: z.string().regex(/^[0-9a-f]{64}$/),
    reviewerDisplayName: z.string().max(200).nullable(),
    contact: z.string().max(200).nullable(),
    signerName: z.string().max(120).nullable(),
    signerTitle: z.string().max(120).nullable(),
    businessName: z.string().max(120),
    candidates: z
      .array(
        z
          .object({
            prefix: z.string().max(2_000),
            suffix: z.string().max(4_096),
            thanks: z.boolean(),
            choices: replyVoiceChoicesSchema,
          })
          .strict(),
      )
      .min(1)
      .max(102),
  })
  .strict()
export type ReplyDraftingV2Frame = z.infer<typeof replyDraftingV2FrameSchema>

/** Word-start stems include the configured Spanish and Bulgarian thank-you forms. */
export function replyContainsThanks(text: string): boolean {
  return /(?<!\p{L})(?:thank\p{L}*|appreciat\p{L}*|gracias|agradec\p{L}*|благодар\p{L}*)/iu.test(
    text,
  )
}

export function frameReplyDraftingV2(body: string, frame: ReplyDraftingV2Frame) {
  const thankingBody = replyContainsThanks(body)
  const candidate = frame.candidates.find((item) => !thankingBody || !item.thanks)
  if (!candidate) throw new TypeError('V2 frame requires an omitted-closing candidate')
  return {
    replyText: [candidate.prefix.trim(), body.trim(), candidate.suffix.trim()]
      .filter(Boolean)
      .join('\n\n'),
    voiceDigest: frame.voiceDigest,
    voiceChoices: candidate.choices,
  }
}
