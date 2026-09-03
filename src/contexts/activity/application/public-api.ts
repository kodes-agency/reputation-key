import type { RecentActivityEntry } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type {
  OperationalActionHistoryAccessInput,
  exportOperationalActionHistory,
} from './use-cases/operational-action-history-access'
import type { OperationalActionHistoryPage } from '../ports/operational-action-history-store.port'
import type { ResourceType } from '../domain/types'

export type { RecentActivityEntry } from '../domain/types'

export type ActivityPublicApi = Readonly<{
  getActivityTimeline(
    input: { resourceType: ResourceType; resourceId: string; limit?: number },
    ctx: AuthContext,
  ): Promise<readonly RecentActivityEntry[]>
  listRecentActivity(
    input: { propertyId?: PropertyId; limit?: number; offset?: number },
    ctx: AuthContext,
  ): Promise<readonly RecentActivityEntry[]>
  listOperationalActionHistory(
    input: OperationalActionHistoryAccessInput,
    ctx: AuthContext,
  ): Promise<OperationalActionHistoryPage>
  exportOperationalActionHistory(
    input: OperationalActionHistoryAccessInput,
    ctx: AuthContext,
  ): ReturnType<ReturnType<typeof exportOperationalActionHistory>>
}>
