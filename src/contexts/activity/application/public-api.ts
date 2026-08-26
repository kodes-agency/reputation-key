import type { RecentActivityEntry } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'

export type {
  ActivityLog,
  RecentActivityEntry,
  ActivityAction,
  ResourceType,
  ActivityPayload,
} from '../domain/types'

export type ActivityPublicApi = Readonly<{
  getActivityTimeline(
    input: { resourceType: string; resourceId: string; limit?: number },
    ctx: AuthContext,
  ): Promise<readonly RecentActivityEntry[]>
  getOrgActivity(
    input: { propertyId?: PropertyId; limit?: number; offset?: number },
    ctx: AuthContext,
  ): Promise<readonly RecentActivityEntry[]>
}>
