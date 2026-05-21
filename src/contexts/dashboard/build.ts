// Dashboard context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the dashboard context.

import type { Database } from '#/shared/db'
import { createDashboardRepository } from './infrastructure/repositories/dashboard.repository'
import { getDashboardData } from './application/use-cases/get-dashboard-data'

export type DashboardContextBuildInput = Readonly<{
  db: Database
}>

export type DashboardContextApi = Readonly<{
  getDashboardData: ReturnType<typeof getDashboardData>
}>

export const buildDashboardContext = (input: DashboardContextBuildInput): DashboardContextApi => {
  const dashboardRepo = createDashboardRepository(input.db)

  const getDashboard = getDashboardData({
    repo: dashboardRepo,
  })

  return {
    getDashboardData: getDashboard,
  }
}
