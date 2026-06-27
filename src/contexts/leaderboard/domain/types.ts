// Leaderboard context — domain types

import type {
  LeaderboardEntryId,
  LeaderboardSnapshotId,
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { MetricKey } from '#/shared/domain/metric-keys'

export type LeaderboardPeriod =
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'all_time'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'

export type LeaderboardScope = 'portal' | 'portal_group'
export type LeaderboardMetricKey = MetricKey

export type LeaderboardEntry = Readonly<{
  id: LeaderboardEntryId
  snapshotId: LeaderboardSnapshotId
  rank: number
  targetType: LeaderboardScope
  targetId: PortalId | PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  score: number
  metricValue: number
  normalizedScore: number
  updatedAt: Date
  createdAt: Date
}>

export type LeaderboardEntryWithTarget = LeaderboardEntry &
  Readonly<{
    targetName: string
    targetLabel: string
  }>

export type LeaderboardRefreshInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  period?: LeaderboardPeriod
  scope?: LeaderboardScope
  metricKey?: LeaderboardMetricKey
}>

export type LeaderboardReconcileResult = Readonly<{
  snapshotsRefreshed: number
  entriesWritten: number
}>

export type LeaderboardRowInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  targetType: LeaderboardScope
  targetId: PortalId | PortalGroupId
  portalId?: PortalId
  portalGroupId?: PortalGroupId
  metricValue: number
}>
