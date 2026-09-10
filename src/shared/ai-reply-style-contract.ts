import { z } from 'zod/v4'

/**
 * Ten real with-text exemplars occur in the largest supplied rating band. Two
 * slots of headroom admit modest library growth while bounding request cost;
 * canonical payload bytes remain the final fail-closed authority.
 */
export const AI_REPLY_STYLE_MAX_EXEMPLARS = 12

const boundedStyleText = z.string().max(4_096)
const SLOT_OR_CONTACT_DETAIL =
  /[{}]|(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|https?:\/\/\S+|\b(?:\+?\d[\d(). -]{6,}\d)\b)/iu

export function replyStyleExampleHasRestrictedMaterial(
  body: string,
  escalationContact: string | null,
): boolean {
  const normalizedBody = body.normalize('NFKC').toLowerCase()
  const normalizedContact = escalationContact?.normalize('NFKC').trim().toLowerCase()
  return (
    SLOT_OR_CONTACT_DETAIL.test(body) ||
    (normalizedContact !== undefined &&
      normalizedContact.length > 0 &&
      normalizedBody.includes(normalizedContact))
  )
}

export const aiReplyStyleSchema = z
  .object({
    localProfile: z
      .object({
        greeting: boundedStyleText,
        signOffPositive: boundedStyleText,
        signOffNegative: boundedStyleText,
        emojiAllowed: z.boolean(),
        escalationContact: boundedStyleText.nullable(),
      })
      .strict(),
    exemplars: z
      .array(boundedStyleText.trim().min(1))
      .min(1)
      .max(AI_REPLY_STYLE_MAX_EXEMPLARS),
  })
  .strict()
  .superRefine((value, context) => {
    value.exemplars.forEach((exemplar, index) => {
      if (
        replyStyleExampleHasRestrictedMaterial(
          exemplar,
          value.localProfile.escalationContact,
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['exemplars', index],
          message: 'reply style exemplar contains a slot or contact detail',
        })
      }
    })
  })

export type AiReplyStyle = Readonly<z.infer<typeof aiReplyStyleSchema>>
