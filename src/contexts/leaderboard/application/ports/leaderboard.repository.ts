// Leaderboard context — repository port

import type {
  LeaderboardEntryWithTarget,
  LeaderboardMetricKey,
  LeaderboardPeriod,
  LeaderboardRefreshInput,
  LeaderboardReconcileResult,
  LeaderboardScope,
} from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type GetLeaderboardQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  period: LeaderboardPeriod
  scope: LeaderboardScope
  metricKey: LeaderboardMetricKey
  limit?: number
}>

export type LeaderboardRepository = Readonly<{
  refresh: (input: LeaderboardRefreshInput) => Promise<LeaderboardReconcileResult>
  reconcileAll: () => Promise<LeaderboardReconcileResult>
  getLeaderboard: (
    input: GetLeaderboardQuery,
  ) => Promise<ReadonlyArray<LeaderboardEntryWithTarget>>
}>
