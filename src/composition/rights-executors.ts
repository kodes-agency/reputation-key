// The executors the manual rights script runs, in the order it runs them. The
// script supplies effects it owns (the database, the job queue); this module
// decides which executors exist for a request and what each one is given.

import { randomUUID } from 'node:crypto'
import type { Database } from '#/shared/db'
import { NOTIFICATION_RIGHTS_TABLES } from '#/contexts/feed/application/public-api'
import {
  createAiErasureReplayers,
  createAiRightsExecutor,
} from '#/contexts/ai/infrastructure/adapters/ai-rights.adapter'
import {
  activityReplayRefusal,
  createActivityErasureReplayers,
  createActivityRightsExecutor,
} from '#/contexts/feed/infrastructure/adapters/activity-rights.adapter'
import type {
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  createGuestContactRequestErasureReplayer,
  createGuestFeedbackErasureReplayer,
  createGuestResponseErasureReplayer,
} from '#/contexts/guest/infrastructure/adapters/guest-response-erasure-replayer.adapter'
import {
  createGuestBackupErasureReplayer,
  createGuestPropertyErasureReplayer,
} from '#/contexts/guest/infrastructure/adapters/guest-backup-erasure-replayer.adapter'
import {
  createIdentityRightsExecutor,
  createStaffRightsExecutor,
  identityOrganizationErasureReplayer,
  identityPropertyErasureReplayer,
  staffOrganizationErasureReplayer,
  staffPropertyErasureReplayer,
} from '#/contexts/identity/infrastructure/adapters/identity-rights.adapter'
import {
  createPropertyRightsExecutor,
  propertyErasureReplayer,
  propertyOrganizationErasureReplayer,
} from '#/contexts/property/infrastructure/adapters/property-rights.adapter'
import {
  createGuestRightsExecutor,
  type GuestRightsExecutorDeps,
} from '#/contexts/guest/infrastructure/adapters/guest-rights.adapter'
import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import {
  createPortalErasureReplayers,
  createPortalRightsExecutor,
} from '#/contexts/portal/infrastructure/adapters/portal-rights.adapter'
import {
  createReportingRightsExecutor,
  createReportingRightsReplayers,
} from '#/contexts/reporting/infrastructure/adapters/reporting-rights.adapter'
import { createRetiredReadingsReplayer } from '#/contexts/reporting/infrastructure/adapters/retired-readings-erasure.adapter'
import { createStaffParticipantErasureReplayer } from '#/contexts/identity/infrastructure/adapters/staff-participant-erasure-replayer.adapter'
import { createStaffParticipantRightsExecutor } from '#/contexts/identity/infrastructure/adapters/staff-participant-rights.adapter'
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
  createInboxRightsReplayers,
  createReviewRightsExecutor,
  createReviewRightsReplayers,
} from '#/shared/ops/rights/review-inbox-rights-executors'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import type { RightsJournal } from '#/shared/ops/rights/rights-journal'
import {
  createWorkItemsRightsExecutor,
  workItemsErasureReplayer,
} from '#/shared/ops/rights/work-items-rights-executor'
import { reputationReplyScopeEffects } from './reply-scope-effects'

export type RightsExecutorsDeps = Readonly<{
  db: Database
  journal: RightsJournal
  runNotification: NotificationRightsExecutorDeps['run']
  portalObjectStore: Pick<StoragePort, 'deleteObject'>
  /**
   * Server-side secret the audit pseudonyms are keyed with (AUDIT_PSEUDONYM_SECRET).
   * A replay under a rotated secret writes other pseudonyms, consistent within
   * the replayed scope. Absent, a Property or Organization erasure refuses at
   * preflight, before anything changes, and a restore refuses an Activity entry.
   */
  auditPseudonymSecret: string | undefined
  /** The named operator for guest-response erasure; absent means that apply is denied. */
  operator?: GuestRightsExecutorDeps['operator']
  now?: () => Date
}>

/**
 * A final warning runs the notification executor alone. Staff runs before
 * Portal because Staff rows reference Portals, and after Guest and Reporting
 * because their rows reference Staff participations. Property tombstones and
 * the platform's work items come last.
 */
export function composeRightsExecutors(
  deps: RightsExecutorsDeps,
  finalWarning: boolean,
): ReadonlyArray<RightsExecutor> {
  const now = deps.now ?? (() => new Date())
  const notification = createNotificationRightsExecutor({
    finalWarning,
    tables: NOTIFICATION_RIGHTS_TABLES,
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
    createGuestRightsExecutor({
      db: deps.db,
      now,
      idGen: randomUUID,
      operator: deps.operator,
    }),
    createReportingRightsExecutor(deps.db, now),
    // Staff rows reference Portals, and Guest and Reporting rows reference Staff;
    // restore replay repeats this order.
    createStaffRightsExecutor(deps.db),
    createPortalRightsExecutor({
      db: deps.db,
      objectStore: deps.portalObjectStore,
      now,
    }),
    createAiRightsExecutor(deps.db, now),
    createActivityRightsExecutor(deps.db, deps.auditPseudonymSecret),
    createIdentityRightsExecutor(deps.db, now),
    createPropertyRightsExecutor(deps.db, now),
    notification,
    createStaffParticipantRightsExecutor({ db: deps.db, journal: deps.journal, now }),
    createWorkItemsRightsExecutor(deps.db),
  ]
}

/**
 * Why a restore cannot replay these journal entries with this configuration,
 * or null. The restore asks before it changes anything.
 */
export function rightsReplayRefusal(
  entries: ReadonlyArray<Pick<BackupErasureLedgerEntry, 'context'>>,
  deps: Pick<RightsExecutorsDeps, 'auditPseudonymSecret'>,
): string | null {
  return activityReplayRefusal(entries, deps.auditPseudonymSecret)
}

/** One replayer per journaled (context, subject class), for restore replay. */
export function composeRightsReplayers(
  deps: Pick<RightsExecutorsDeps, 'db' | 'now' | 'auditPseudonymSecret'> &
    Readonly<{ notificationReplayers: ReadonlyArray<BackupErasureReplayer> }>,
): ReadonlyArray<BackupErasureReplayer> {
  const now = deps.now ?? (() => new Date())
  return [
    ...createGoogleRightsReplayers(now),
    ...createReviewRightsReplayers({
      db: deps.db,
      now,
      replyEffects: reputationReplyScopeEffects,
    }),
    ...createInboxRightsReplayers({ db: deps.db, now }),
    createGuestBackupErasureReplayer(),
    createGuestPropertyErasureReplayer(),
    createGuestResponseErasureReplayer(),
    createGuestFeedbackErasureReplayer(),
    createGuestContactRequestErasureReplayer(),
    ...createReportingRightsReplayers(now),
    createRetiredReadingsReplayer(),
    ...createPortalErasureReplayers(),
    ...createAiErasureReplayers(now),
    ...createActivityErasureReplayers(deps.auditPseudonymSecret),
    identityPropertyErasureReplayer,
    identityOrganizationErasureReplayer,
    staffOrganizationErasureReplayer,
    staffPropertyErasureReplayer,
    propertyErasureReplayer,
    propertyOrganizationErasureReplayer,
    createStaffParticipantErasureReplayer(),
    workItemsErasureReplayer,
    ...deps.notificationReplayers,
  ]
}
