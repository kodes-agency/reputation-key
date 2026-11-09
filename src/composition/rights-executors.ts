// The executors the manual rights script runs, in the order it runs them. The
// script supplies effects it owns (the database, the job queue); this module
// decides which executors exist for a request and what each one is given.

import { randomUUID } from 'node:crypto'
import type { Database } from '#/shared/db'
import {
  createGuestRightsExecutor,
  type GuestRightsExecutorDeps,
} from '#/contexts/guest/infrastructure/adapters/guest-rights.adapter'
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
  /** The named operator for guest-response erasure; absent means that apply is denied. */
  operator?: GuestRightsExecutorDeps['operator']
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
    createGuestRightsExecutor({
      db: deps.db,
      now,
      idGen: randomUUID,
      operator: deps.operator,
    }),
    createReportingRightsExecutor(deps.db, now),
    notification,
  ]
}
