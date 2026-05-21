// Dashboard context — Zod schemas for server function validation
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Note: organizationId is derived from the authenticated session, never from client input.

import { z } from 'zod/v4'

export const timeRangePreset = z.enum(['7d', '30d', '90d'])

export type TimeRangePreset = z.infer<typeof timeRangePreset>

// GET dashboard data — query params
export const getDashboardDataDto = z.object({
  propertyId: z.string().uuid(),
  portalId: z.string().uuid().optional(),
  timeRange: timeRangePreset.default('30d'),
})
