// organizationId comes from the authenticated session, never client input.

import { z } from 'zod/v4'

import { timeRangePreset } from '../../portal-results/contracts'
export { timeRangePreset, getPortalAnalyticsDto } from '../../portal-results/contracts'
export type { TimeRangePreset } from '../../portal-results/contracts'

// GET dashboard data — query params
export const getDashboardDataDto = z.object({
  propertyId: z.uuid(),
  portalId: z.uuid().optional(),
  timeRange: timeRangePreset.default('30d'),
})

// GET Portals overview results — one Property's Portals, or, with no Property
// named, every Portal of the Organization the caller may read, together. All
// Time is available on a single Portal; this overview compares bounded windows.
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
