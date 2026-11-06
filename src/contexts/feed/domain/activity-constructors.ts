import type { RecentActivityEntry } from './activity-types'
import { userId, type UserId } from '#/shared/domain/ids'

/** System user ID for automated / background operations. */
export const SYSTEM_USER_ID: UserId = userId('system')
export const REDACTED_RECENT_ACTIVITY_ACTOR_NAME = 'Former member'

export const withRedactedRecentActivityActor = (
  entry: RecentActivityEntry,
): RecentActivityEntry => ({
  ...entry,
  actorId: SYSTEM_USER_ID,
  actorName: REDACTED_RECENT_ACTIVITY_ACTOR_NAME,
  actorAvatarUrl: null,
  actorRole: 'Member',
})
