import type { AuthContext } from '#/shared/domain/auth-context'
import type {
  OperationalActionHistoryAccessInput,
  exportOperationalActionHistory,
} from './use-cases/operational-action-history-access'
import type { OperationalActionHistoryPage } from '../ports/operational-action-history-store.port'

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
