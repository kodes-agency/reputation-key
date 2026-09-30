// Dashboard context — Zod schemas for server function validation
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Note: organizationId is derived from the authenticated session, never from client input.

import { z } from 'zod/v4'

export const timeRangePreset = z.enum(['7d', '30d', '60d', '90d', '180d', 'all'])

export type TimeRangePreset = z.infer<typeof timeRangePreset>

// GET dashboard data — query params
export const getDashboardDataDto = z.object({
  propertyId: z.uuid(),
  portalId: z.uuid().optional(),
  timeRange: timeRangePreset.default('30d'),
})

// GET portal analytics — query params
export const getPortalAnalyticsDto = z.object({
  propertyId: z.uuid(),
  portalId: z.uuid(),
  timeRange: timeRangePreset.default('30d'),
  /** Also read the equal-length window before. */
  compare: z.boolean().default(true),
})
