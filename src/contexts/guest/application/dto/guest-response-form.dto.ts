import { z } from 'zod/v4'
import { privateFeedbackTextSchema } from './private-feedback.dto'

/**
 * One validation authority for the public Guest journey and its server
 * functions. The UI derives its form schemas from these transport DTOs instead
 * of restating rating, feedback, nonce, or bot-trap constraints in components.
 */
export const guestResponseMutationDto = z.object({
  token: z.string().min(1).max(256),
  csrfNonce: z.uuid(),
})

export const guestRatingMutationDto = guestResponseMutationDto.extend({
  rating: z.number().int().min(1).max(5),
  responseConsent: z.literal(true),
  honeypot: z.string().max(256).optional(),
})

export const guestPrivateFeedbackMutationDto = guestResponseMutationDto.extend({
  text: privateFeedbackTextSchema,
  textConsent: z.literal(true),
  honeypot: z.string().max(256).optional(),
})

export const guestSecondaryLinkMutationDto = guestResponseMutationDto.extend({
  linkId: z.string().min(1).max(255),
})

export const guestRatingFormDto = guestRatingMutationDto.pick({ rating: true }).extend({
  honeypot: guestRatingMutationDto.shape.honeypot.unwrap(),
})

export const guestPrivateFeedbackFormDto = guestPrivateFeedbackMutationDto
  .pick({ text: true })
  .extend({
    honeypot: guestPrivateFeedbackMutationDto.shape.honeypot.unwrap(),
  })

export type GuestRatingFormInput = z.input<typeof guestRatingFormDto>
export type GuestPrivateFeedbackFormInput = z.input<typeof guestPrivateFeedbackFormDto>
