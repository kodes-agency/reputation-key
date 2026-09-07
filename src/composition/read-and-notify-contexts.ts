// Composition — the downstream read and notification contexts.
//
// ARC-03-T10. Reporting, Activity, and Notification are downstream contexts:
// each consumes upstream public interfaces and produces read models,
// projections, or notifications. Composing them together keeps the root's
// remaining wiring readable as "upstream graph, then downstream contexts".
//
// The Goal correction policy lives here because it authorizes Reporting's
// scheduled Goal reconciliation and nothing else.

import { buildReportingContext } from '#/contexts/reporting/build'
import { buildActivityContext } from '#/contexts/activity/build'
import { buildNotificationContext } from '#/contexts/notification/build'
import { createScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { recentActivityEntryId } from '#/shared/domain/ids'
import { operationalActionHistoryRecordId } from '#/contexts/activity/domain/operational-action-history'
import type { Queue } from 'bullmq'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { OutboxRepository } from '#/shared/outbox'
import type { buildStaffContext } from '#/contexts/staff/build'
import type { buildPropertyContext } from '#/contexts/property/build'
import type { buildPortalContext } from '#/contexts/portal/build'
import type { buildGuestContext } from '#/contexts/guest/build'
import type { buildReviewContext } from '#/contexts/review/build'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { InboxContextApi } from '#/contexts/inbox/build'

export type ReadAndNotifyContextsInput = Readonly<{
  db: Database
  clock: Clock
  idGen: () => string
  logger: LoggerPort
  outboxRepo: OutboxRepository
  jobQueue: Queue | undefined
  staff: ReturnType<typeof buildStaffContext>
  property: ReturnType<typeof buildPropertyContext>
  portal: ReturnType<typeof buildPortalContext>
  guest: ReturnType<typeof buildGuestContext>
  review: ReturnType<typeof buildReviewContext>
  identity: ReturnType<typeof buildIdentityContext>
  inbox: InboxContextApi
  /** Review-owned governed serving reads, forwarded to Dashboard. */
  reviewServingStats: ReturnType<typeof buildReviewContext>['lookups']['servingStats']
}>

export function buildReadAndNotifyContexts(input: ReadAndNotifyContextsInput) {
  const authorizeGoalCorrectionScope =
    createScheduledScopeAuthorizer('system:goal.maintain')
  const goalCorrectionPolicy = {
    authorize: async (request: {
      actor: unknown
      organizationId: string
      propertyId: string
      action: string
    }): Promise<void> => {
      if (
        request.actor !== 'system' ||
        request.action !== 'goal.update' ||
        !(await authorizeGoalCorrectionScope(request.organizationId, request.propertyId))
      ) {
        throw new Error('Goal metric-correction reconciliation is not authorized')
      }
    },
  } as const

  const reporting = buildReportingContext({
    db: input.db,
    clock: input.clock,
    idGen: input.idGen,
    logger: input.logger,
    portalGroupApi: input.portal.publicApi.portalGroup,
    portalApi: input.portal.publicApi.portal,
    reviewRatingLookup: input.review.publicApi,
    propertyApi: input.property.publicApi,
    staffPublicApi: input.staff.publicApi,
    reviewServingStats: input.reviewServingStats,
    inboxTargets: input.inbox.publicApi,
    guestResponseIntegrity: input.guest.publicApi,
  })

  // ── Activity context ────────────────────────────────────────────
  const activity = buildActivityContext({
    db: input.db,
    outboxRepo: input.outboxRepo,
    staffPublicApi: input.staff.publicApi,
    clock: input.clock,
    logger: input.logger,
    idGen: () => recentActivityEntryId(crypto.randomUUID()),
    operationalHistoryIdGen: () => operationalActionHistoryRecordId(crypto.randomUUID()),
    operationalHistoryHoldIdGen: () => crypto.randomUUID(),
    operationalHistoryAccessAuthority: input.identity.publicApi.accountAdminAuthority,
  })

  // ── Notification context ──────────────────────────────────────────
  const notification = buildNotificationContext({
    db: input.db,
    outboxRepo: input.outboxRepo,
    queue: input.jobQueue,
    clock: input.clock,
    idGen: input.idGen,
    logger: input.logger,
    responsibleManagers: {
      findForProperty: (orgId, pid) =>
        input.property.publicApi.getResponsibleManagerUserIds(orgId, pid),
      findForPortal: (orgId, pid) =>
        input.portal.publicApi.portal.getResponsibleManagerUserIds(orgId, pid),
      findForPortalGroup: async (orgId, groupId) => {
        const portalIds = await input.portal.publicApi.portalGroup.getGroupPortalIds(
          orgId,
          groupId,
        )
        const recipients = await Promise.all(
          portalIds.map((pid) =>
            input.portal.publicApi.portal.getResponsibleManagerUserIds(orgId, pid),
          ),
        )
        return [...new Set(recipients.flat())]
      },
      isEligibleForProperty: (orgId, pid, managerId) =>
        input.property.publicApi.isEligibleResponsibleManagerUserId(
          orgId,
          pid,
          managerId,
        ),
    },
    feedbackPortalLookup: {
      findPortalId: (orgId, sourceId) =>
        input.guest.publicApi.findPortalIdForFeedback(orgId, sourceId),
    },
    googleConnectionProperties: {
      findGoogleNotificationAnchor: (connectionIdValue, orgId) =>
        input.property.publicApi.findGoogleNotificationAnchor(connectionIdValue, orgId),
    },
    monthlyResultFacts: {
      findMonthlyResultNotificationFacts:
        reporting.publicApi.findMonthlyResultNotificationFacts,
      findMonthlyResultRevisionNotificationFacts:
        reporting.publicApi.findMonthlyResultRevisionNotificationFacts,
    },
    portalHealthLookup: {
      findPortalHealthNotificationFacts:
        input.portal.publicApi.portal.findPortalHealthNotificationFacts,
    },
  })

  return Object.freeze({
    reporting,
    goalCorrectionPolicy,
    activity,
    notification,
  } as const)
}
