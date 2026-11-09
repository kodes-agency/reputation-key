// The executors the manual rights script runs, in the order it runs them. The
// script supplies effects it owns (the database, the job queue); this module
// decides which executors exist for a request and what each one is given.

import type { Database } from '#/shared/db'
import { createPortalRightsExecutor } from '#/contexts/portal/infrastructure/adapters/portal-rights.adapter'
import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import { createReportingRightsExecutor } from '#/contexts/reporting/infrastructure/adapters/reporting-rights.adapter'
import { createGoogleRightsExecutor } from '#/shared/ops/rights/google-rights-executor'
import {
  createNotificationRightsExecutor,
  type NotificationRightsExecutorDeps,
} from '#/shared/ops/rights/notification-rights-executor'
import {
  createInboxRightsExecutor,
  createReviewRightsExecutor,
} from '#/shared/ops/rights/review-inbox-rights-executors'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import { reputationReplyScopeEffects } from './reply-scope-effects'

export type RightsExecutorsDeps = Readonly<{
  db: Database
  runNotification: NotificationRightsExecutorDeps['run']
  portalObjectStore: Pick<StoragePort, 'deleteObject'>
  now?: () => Date
}>

/** A final warning runs the notification executor alone. */
export function composeRightsExecutors(
  deps: RightsExecutorsDeps,
  finalWarning: boolean,
): ReadonlyArray<RightsExecutor> {
  const now = deps.now ?? (() => new Date())
  const notification = createNotificationRightsExecutor({
    finalWarning,
    run: deps.runNotification,
  })
  if (finalWarning) return [notification]
  if (!deps.portalObjectStore) throw new Error('Portal image store is required')
  return [
    createGoogleRightsExecutor({ db: deps.db, now }),
    createReviewRightsExecutor({
      db: deps.db,
      now,
      replyEffects: reputationReplyScopeEffects,
    }),
    createInboxRightsExecutor({ db: deps.db, now }),
    createReportingRightsExecutor(deps.db, now),
    createPortalRightsExecutor({
      db: deps.db,
      objectStore: deps.portalObjectStore,
      now,
    }),
    notification,
  ]
}
