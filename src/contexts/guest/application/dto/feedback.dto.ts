import { z } from 'zod/v4'

export const feedbackInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  comment: z.string().min(1, 'Feedback cannot be empty').max(1000),
  ratingId: z.string().uuid().optional(),
  source: z.enum(['qr', 'nfc', 'direct']).default('direct'),
  honeypot: z.string().optional(),
  submittedAt: z.number().optional(),
})

export type FeedbackInput = z.infer<typeof feedbackInputSchema>
