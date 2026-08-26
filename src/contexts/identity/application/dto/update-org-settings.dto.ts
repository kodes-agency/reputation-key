// Identity context — DTO for organization settings updates
// Zod schema for org settings form validation.

import { z } from 'zod/v4'

export const updateOrgSettingsSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100),
    slug: z.string().min(1, 'Slug is required').max(64),
    contactEmail: z.union([z.email('Invalid email'), z.literal('')]).nullable(),
  })
  .strict()

export type UpdateOrgSettingsInput = z.infer<typeof updateOrgSettingsSchema>
