// Dashboard context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the dashboard context.

import type { ReviewStatsPort } from './application/ports/review-stats.port'
import type { MetricStatsPort } from './application/ports/metric-stats.port'
import { createDashboardRepository } from './infrastructure/repositories/dashboard.repository'
import { getDashboardData } from './application/use-cases/get-dashboard-data'

export type DashboardContextBuildInput = Readonly<{
  reviewStats: ReviewStatsPort
  metricStats: MetricStatsPort
}>

export type DashboardContextApi = Readonly<{
  getDashboardData: ReturnType<typeof getDashboardData>
}>

export const buildDashboardContext = (
  input: DashboardContextBuildInput,
): DashboardContextApi => {
  const dashboardRepo = createDashboardRepository(input.reviewStats, input.metricStats)

  const getDashboard = getDashboardData({
    repo: dashboardRepo,
  })

  return {
    getDashboardData: getDashboard,
  }
}
