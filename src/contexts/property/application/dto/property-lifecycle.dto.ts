import { z } from 'zod/v4'

export const propertyLifecycleTargetSchema = z.object({
  propertyId: z.string().trim().min(1, 'Property ID is required'),
})

export const archivePropertyInputSchema = propertyLifecycleTargetSchema.extend({
  reason: z
    .string()
    .trim()
    .min(3, 'Archive reason must be at least 3 characters')
    .max(500, 'Archive reason must be at most 500 characters'),
})

export type ArchivePropertyDto = z.infer<typeof archivePropertyInputSchema>
export type PropertyLifecycleTargetDto = z.infer<typeof propertyLifecycleTargetSchema>
