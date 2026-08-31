import type { RecentActivityEntry } from '../domain/types'
import type {
  ObsoleteRecentActivityReplayFact,
  ProjectableRecentActivityReplayFact,
} from '../domain/recent-activity-replay-fact'

export const ACTIVITY_RECENT_ACTIVITY_CONSUMER = 'activity.recent-activity' as const

export type ActivityDeliveryOutcome = 'applied' | 'duplicate'

export type ActivityDeliveryStore = Readonly<{
  applyOnce(
    input: Readonly<{
      entry: RecentActivityEntry
      replayFact: ProjectableRecentActivityReplayFact
      eventId: string
      consumerName: typeof ACTIVITY_RECENT_ACTIVITY_CONSUMER
    }>,
  ): Promise<ActivityDeliveryOutcome>
  recordObsolete(
    input: Readonly<{
      replayFact: ObsoleteRecentActivityReplayFact
      eventId: string
      consumerName: typeof ACTIVITY_RECENT_ACTIVITY_CONSUMER
    }>,
  ): Promise<'obsolete'>
}>
