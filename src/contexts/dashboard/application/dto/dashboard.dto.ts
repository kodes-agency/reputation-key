// Dashboard context — Zod schemas for server function validation
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Note: organizationId is derived from the authenticated session, never from client input.

import { z } from 'zod/v4'

export const timeRangePreset = z.enum(['7d', '30d', '60d', '90d', 'all'])

export type TimeRangePreset = z.infer<typeof timeRangePreset>

export const TIME_RANGE_OPTIONS: { value: TimeRangePreset; label: string }[] = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '60d', label: '60 Days' },
  { value: '90d', label: '90 Days' },
  { value: 'all', label: 'All Time' },
]

// GET dashboard data — query params
export const getDashboardDataDto = z.object({
  propertyId: z.string().uuid(),
  portalId: z.string().uuid().optional(),
  timeRange: timeRangePreset.default('all'),
})

// GET portal analytics — query params
export const getPortalAnalyticsDto = z.object({
  propertyId: z.string().uuid(),
  portalId: z.string().uuid(),
  timeRange: timeRangePreset.default('all'),
})
