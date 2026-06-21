// Leaderboard context — Drizzle row mapper

import { assertLiteral } from '#/shared/domain/assert'
import { METRIC_KEYS } from '#/shared/domain/metric-keys'
import type {
  LeaderboardEntry,
  LeaderboardSnapshot,
  LeaderboardMetricKey,
} from '../../domain/types'
import {
  leaderboardEntryId,
  leaderboardSnapshotId,
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import {
  leaderboardEntries,
  leaderboardSnapshots,
} from '#/shared/db/schema/leaderboard.schema'

const VALID_PERIODS: readonly string[] = [
  'today',
  'this_week',
  'this_month',
  'this_quarter',
  'all_time',
  'last_7_days',
  'last_30_days',
  'last_90_days',
]
const VALID_SCOPES: readonly string[] = ['portal', 'portal_group']
const VALID_METRIC_KEYS: readonly string[] = [...METRIC_KEYS, 'overall']

export function leaderboardSnapshotFromRow(
  row: typeof leaderboardSnapshots.$inferSelect,
): LeaderboardSnapshot {
  return {
    id: leaderboardSnapshotId(row.id),
    propertyId: propertyId(row.propertyId),
    period: assertLiteral(
      row.period,
      VALID_PERIODS,
      'leaderboard.period',
    ) as LeaderboardSnapshot['period'],
    scope: assertLiteral(
      row.scope,
      VALID_SCOPES,
      'leaderboard.scope',
    ) as LeaderboardSnapshot['scope'],
    metricKey: assertLiteral(
      row.metricKey,
      VALID_METRIC_KEYS,
      'leaderboard.metricKey',
    ) as LeaderboardMetricKey,
    scoreKey: row.scoreKey,
    lastUpdatedAt: row.lastUpdatedAt,
    createdAt: row.createdAt,
  }
}

export function leaderboardEntryFromRow(
  row: typeof leaderboardEntries.$inferSelect,
): LeaderboardEntry {
  return {
    id: leaderboardEntryId(row.id),
    snapshotId: leaderboardSnapshotId(row.snapshotId),
    rank: row.rank,
    targetType: assertLiteral(
      row.targetType,
      VALID_SCOPES,
      'leaderboard.targetType',
    ) as LeaderboardEntry['targetType'],
    targetId:
      row.targetType === 'portal' ? portalId(row.targetId) : portalGroupId(row.targetId),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    score: row.score,
    metricValue: row.metricValue,
    normalizedScore: row.normalizedScore,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }
}
