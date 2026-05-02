import { z } from 'zod/v4'

export const ratingInputSchema = z.object({
  portalId: z.string().uuid('Invalid portal ID'),
  value: z.number().int().min(1).max(5),
  source: z.enum(['qr', 'nfc', 'direct']).default('direct'),
})

export type RatingInput = z.infer<typeof ratingInputSchema>
