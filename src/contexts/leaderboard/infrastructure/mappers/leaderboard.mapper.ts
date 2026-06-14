// Leaderboard context — Drizzle row mapper

import type { LeaderboardEntry, LeaderboardSnapshot } from '../../domain/types'
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

export function leaderboardSnapshotFromRow(
  row: typeof leaderboardSnapshots.$inferSelect,
): LeaderboardSnapshot {
  return {
    id: leaderboardSnapshotId(row.id),
    propertyId: propertyId(row.propertyId),
    period: row.period as LeaderboardSnapshot['period'],
    scope: row.scope as LeaderboardSnapshot['scope'],
    metricKey: row.metricKey as LeaderboardSnapshot['metricKey'],
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
    targetType: row.targetType as LeaderboardEntry['targetType'],
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
