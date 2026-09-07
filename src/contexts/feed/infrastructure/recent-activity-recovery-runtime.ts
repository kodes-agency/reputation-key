import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  getRecentActivityReadiness,
  recoverRecentActivity,
} from '../application/use-cases/recover-recent-activity'
import { createActivityDbUserLookupAdapter } from './adapters/activity-db-user-lookup.adapter'
import { createActivityRecoveryStore } from './activity-recovery-store'

/** Shared construction seam for the web context and the audited operator CLI. */
export const createRecentActivityRecoveryRuntime = (db: Database, logger: LoggerPort) => {
  const store = createActivityRecoveryStore(db)
  return {
    recoverRecentActivity: recoverRecentActivity({
      store,
      userLookup: createActivityDbUserLookupAdapter(db),
      logger,
    }),
    getRecentActivityReadiness: getRecentActivityReadiness({ store }),
  } as const
}
