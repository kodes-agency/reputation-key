// The executors the manual rights script runs, in the order it runs them. The
// script supplies effects it owns (the database, the job queue); this module
// decides which executors exist for a request and what each one is given.

import type { Database } from '#/shared/db'
import type { BackupErasureReplayer } from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  createReportingRightsExecutor,
  createReportingRightsReplayers,
} from '#/contexts/reporting/infrastructure/adapters/reporting-rights.adapter'
import {
  createGoogleRightsExecutor,
  createGoogleRightsReplayers,
} from '#/shared/ops/rights/google-rights-executor'
import {
  createNotificationRightsExecutor,
  type NotificationRightsExecutorDeps,
} from '#/shared/ops/rights/notification-rights-executor'
import {
  createInboxRightsExecutor,
  createInboxRightsReplayer,
  createReviewRightsExecutor,
  createReviewRightsReplayer,
} from '#/shared/ops/rights/review-inbox-rights-executors'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import { reputationReplyScopeEffects } from './reply-scope-effects'

export type RightsExecutorsDeps = Readonly<{
  db: Database
  runNotification: NotificationRightsExecutorDeps['run']
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
  return [
    createGoogleRightsExecutor({ db: deps.db, now }),
    createReviewRightsExecutor({
      db: deps.db,
      now,
      replyEffects: reputationReplyScopeEffects,
    }),
    createInboxRightsExecutor({ db: deps.db, now }),
    createReportingRightsExecutor(deps.db, now),
    notification,
  ]
}

/** One replayer per journaled (context, subject class), for restore replay. */
export function composeRightsReplayers(
  deps: Pick<RightsExecutorsDeps, 'db' | 'now'> &
    Readonly<{ notificationReplayers: ReadonlyArray<BackupErasureReplayer> }>,
): ReadonlyArray<BackupErasureReplayer> {
  const now = deps.now ?? (() => new Date())
  return [
    ...createGoogleRightsReplayers(now),
    createReviewRightsReplayer({
      db: deps.db,
      now,
      replyEffects: reputationReplyScopeEffects,
    }),
    createInboxRightsReplayer({ db: deps.db, now }),
    ...createReportingRightsReplayers(now),
    ...deps.notificationReplayers,
  ]
}
