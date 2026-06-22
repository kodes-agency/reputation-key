// Leaderboard context — Drizzle row mapper

import { assertLiteral } from '#/shared/domain/assert'
import type { LeaderboardEntry } from '../../domain/types'
import {
  leaderboardEntryId,
  leaderboardSnapshotId,
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import { leaderboardEntries } from '#/shared/db/schema/leaderboard.schema'

const VALID_SCOPES: readonly string[] = ['portal', 'portal_group']

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
