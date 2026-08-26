// Portal context — update portal DTO

import { z } from 'zod/v4'

export const updatePortalInputSchema = z
  .object({
    portalId: z.string().min(1, 'Portal ID is required'),
    name: z.string().min(1).max(100).optional(),
    slug: z.string().min(2, 'Must be at least 2 characters').max(64).optional(),
    description: z.string().max(500).nullable().optional(),
    privateFeedbackThreshold: z.number().int().min(1).max(5).optional(),
    // Nullable, not merely optional: `null` is the explicit "remove the hero image"
    // signal from the edit form, while an absent key means "leave unchanged".
    // The schema is .strict(), so until this key existed every removal was rejected.
    heroImageUrl: z.url().nullable().optional(),
    theme: z
      .object({
        primaryColor: z.string(),
        backgroundColor: z.string().optional(),
        textColor: z.string().optional(),
      })
      .optional(),
    publicationState: z.enum(['draft', 'published', 'disabled', 'archived']).optional(),
  })
  .strict()

export type UpdatePortalInput = z.infer<typeof updatePortalInputSchema>
