import type { AuthContext } from '#/shared/domain/auth-context'
import type {
  OperationalActionHistoryAccessInput,
  exportOperationalActionHistory,
} from '../audit/operational-action-history-access.server'
import type { OperationalActionHistoryPage } from '../audit/operational-action-history-store.port.server'

export type { RecentActivityEntry } from '../domain/activity-types'

export type ActivityPublicApi = Readonly<{
  listOperationalActionHistory(
    input: OperationalActionHistoryAccessInput,
    ctx: AuthContext,
  ): Promise<OperationalActionHistoryPage>
  exportOperationalActionHistory(
    input: OperationalActionHistoryAccessInput,
    ctx: AuthContext,
  ): ReturnType<ReturnType<typeof exportOperationalActionHistory>>
}>
