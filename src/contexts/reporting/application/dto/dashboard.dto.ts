// organizationId comes from the authenticated session, never client input.

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

// GET Portals overview results — one Property's Portals, or, with no Property
// named, every Portal of the Organization the caller may read, together. All
// Time is not a window here: a lifetime figure comes from the lifetime
// aggregate, not from readings, and the two would disagree.
export const getPortalResultsOverviewDto = z.object({
  propertyId: z.uuid().optional(),
  timeRange: z
    .enum([
      '7d',
      '30d',
      '60d',
      '90d',
      '180d',
      'all',
      'today',
      'week',
      'month',
      'last-month',
    ])
    .exclude(['all'])
    .default('30d'),
  /** Also read the equal-length window before. */
  compare: z.boolean().default(true),
})
