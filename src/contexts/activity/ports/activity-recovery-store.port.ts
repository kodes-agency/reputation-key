import type { RecentActivityEntry } from '../domain/types'
import type { ProjectableRecentActivityReplayFact } from '../domain/recent-activity-replay-fact'

export type RecentActivityRecoveryCursor = Readonly<{
  sourceOccurredAt: Date
  replayKey: string
}>

export type RecentActivityProjectionGap = Readonly<{
  missingCount: number
  oldestMissingAt: Date | null
  newestSourceAt: Date | null
  replayFactCount: number
  legacySnapshotCount: number
}>

export type ActivityRecoveryStore = Readonly<{
  listMissing(
    input: Readonly<{
      observedAt: Date
      after?: RecentActivityRecoveryCursor
      limit: number
    }>,
  ): Promise<readonly ProjectableRecentActivityReplayFact[]>
  restoreProjection(
    input: Readonly<{
      fact: ProjectableRecentActivityReplayFact
      entry: RecentActivityEntry
    }>,
  ): Promise<'applied' | 'duplicate'>
  readGap(input: Readonly<{ observedAt: Date }>): Promise<RecentActivityProjectionGap>
}>
