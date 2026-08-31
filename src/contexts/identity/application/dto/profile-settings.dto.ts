import { z } from 'zod/v4'

export const updateProfileInputSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
})

export const updateUserImageInputSchema = z.object({ imageUrl: z.url() })

export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>
