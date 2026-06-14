// Leaderboard context — domain events

import assert from 'node:assert/strict'
import type {
  LeaderboardSnapshotId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'
import type { LeaderboardMetricKey, LeaderboardPeriod, LeaderboardScope } from './types'

export type LeaderboardSnapshotRefreshed = Readonly<{
  _tag: 'leaderboard.snapshot.refreshed'
  eventId: string
  correlationId: string | null
  occurredAt: Date
  organizationId: OrganizationId
  propertyId: PropertyId
  period: LeaderboardPeriod
  scope: LeaderboardScope
  metricKey: LeaderboardMetricKey
  snapshotId: LeaderboardSnapshotId
}>

export type LeaderboardEvent = LeaderboardSnapshotRefreshed

export const leaderboardSnapshotRefreshed = (
  args: Omit<LeaderboardSnapshotRefreshed, '_tag' | 'eventId' | 'correlationId'>,
): LeaderboardSnapshotRefreshed => {
  assert(args.organizationId !== ('' satisfies string), 'organizationId required')
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    _tag: 'leaderboard.snapshot.refreshed',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
