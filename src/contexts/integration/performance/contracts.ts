import { z } from 'zod/v4'
import { PROPERTY_PERFORMANCE_PRESETS } from '#/shared/google-performance-report-contract'

export const getPropertyGooglePerformanceInputSchema = z
  .object({
    propertyId: z.uuid(),
    preset: z.enum(PROPERTY_PERFORMANCE_PRESETS),
  })
  .strict()

export const renewPropertyGooglePerformanceLeaseInputSchema = z
  .object({
    propertyId: z.uuid(),
    leaseRef: z.string().min(1).max(512),
  })
  .strict()
