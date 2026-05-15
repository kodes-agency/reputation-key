// Identity context — DTO for organization settings updates
// Zod schema for org settings form validation.

import { z } from 'zod/v4'

export const updateOrgSettingsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(1, 'Slug is required').max(64),
  contactEmail: z.union([z.string().email('Invalid email'), z.literal('')]).nullable(),
  billingCompanyName: z.string().max(200).nullable(),
  billingAddress: z.string().max(300).nullable(),
  billingCity: z.string().max(100).nullable(),
  billingPostalCode: z.string().max(20).nullable(),
  billingCountry: z.string().max(100).nullable(),
})

export type UpdateOrgSettingsInput = z.infer<typeof updateOrgSettingsSchema>
