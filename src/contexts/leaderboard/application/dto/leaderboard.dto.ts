// Leaderboard context — DTOs

import { z } from 'zod/v4'

export const leaderboardPeriodSchema = z.enum([
  'today',
  'this_week',
  'this_month',
  'this_quarter',
  'all_time',
  'last_7_days',
  'last_30_days',
  'last_90_days',
])

export const leaderboardScopeSchema = z.enum(['portal', 'portal_group'])

export const getLeaderboardSchema = z.object({
  propertyId: z.string().uuid(),
  period: leaderboardPeriodSchema.default('this_month'),
  scope: leaderboardScopeSchema.default('portal'),
  metricKey: z
    .enum([
      'overall',
      'portal.rating',
      'portal.feedback',
      'portal.scan',
      'portal.review_link_click',
    ])
    .default('overall'),
})

export type GetLeaderboardInput = z.infer<typeof getLeaderboardSchema>
