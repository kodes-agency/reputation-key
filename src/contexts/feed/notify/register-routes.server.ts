// Every durable notification route, registered against one consumer registry.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { MonthlyResultNotificationFactsLookup } from '#/contexts/reporting/application/public-api'
import type {
  ReplyApprovalAuthorityPort,
  DisplayNameLookupPort,
} from '../application/ports/cross-context-lookups.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { EscalationResolutionLookupPort } from '../application/ports/escalation-resolution-lookup.port'
import type { NotificationRepositoryPort } from '../application/ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from '../application/ports/notification-email-repository.port'
import { createGroupedReopenStore } from '../infrastructure/repositories/notification-grouped-reopen.repository'
import { createActivePropertyLookup } from '../infrastructure/repositories/active-property'
import { registerNotificationConsumers } from '../infrastructure/notification-outbox-consumers'
import { registerPortalNotificationConsumers } from '../infrastructure/portal-outbox-consumers'
import { registerPortalDestinationNotificationConsumer } from '../infrastructure/portal-destination-outbox-consumers'
import { registerPropertyNotificationConsumers } from '../infrastructure/property-outbox-consumers'
import {
  registerReviewImportNotificationConsumers,
  type PropertyImportInitiatorLookup,
} from '../infrastructure/review-import-outbox-consumers'
import {
  registerIntegrationNotificationConsumers,
  type GoogleConnectionPropertyLookup,
} from '../infrastructure/integration-outbox-consumers'
import {
  registerAssignmentReleaseNotificationConsumer,
  registerBulkAssignmentNotificationConsumer,
  registerEscalationResolutionNotificationConsumer,
  registerResponseTargetNotificationConsumer,
  registerWorkflowNotificationConsumers,
  registerHandlingCycleNotificationConsumers,
} from '../infrastructure/inbox-notice-routes'
import {
  registerAiGuestVoiceSummaryNoticeConsumer,
  registerAiUrgentReviewNoticeConsumer,
  registerGoalNotificationConsumer,
  registerRatingGoalNoticeConsumer,
} from '../infrastructure/goal-notice-routes'
import { registerNotificationSettlementConsumers } from '../infrastructure/notification-settlement-outbox-consumers'
import { registerPortalHealthNotificationConsumer } from '../infrastructure/portal-health-outbox-consumers'
import { registerIdentityAccountNotificationConsumers } from '../infrastructure/identity-account-outbox-consumers'
import { createNotificationWorkState, createRetireMovedAssignment } from './settle.server'
import type { NoticeWriter } from './consumers.server'

export type NotificationRouteDeps = Readonly<{
  db: Database
  outboxRepo: OutboxRepository
  clock: () => Date
  logger: LoggerPort
  userLookup: UserLookupPort
  displayNames: DisplayNameLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  replyApproval: ReplyApprovalAuthorityPort
  inboxItemLookup: InboxItemLookupPort
  escalationResolutions: EscalationResolutionLookupPort
  notificationRepo: NotificationRepositoryPort
  emailRepo: NotificationEmailRepositoryPort
  workState: ReturnType<typeof createNotificationWorkState>
  monthlyResultFacts: MonthlyResultNotificationFactsLookup
  googleConnectionProperties: GoogleConnectionPropertyLookup
  propertyImportInitiators: PropertyImportInitiatorLookup
  destinationLookup: Pick<PortalPublicApi, 'findDestinationApprovalNotificationFacts'>
}>

/** Every durable notification route, writing through `noticeWriter`. */
export const registerNotificationRoutes = (
  consumerRegistry: ConsumerRegistry,
  noticeWriter: NoticeWriter,
  deps: NotificationRouteDeps,
) => {
  const {
    db,
    outboxRepo,
    clock,
    logger,
    userLookup,
    displayNames,
    responsibleManagers,
    replyApproval,
    inboxItemLookup,
    escalationResolutions,
    notificationRepo,
    emailRepo,
    workState,
    monthlyResultFacts,
    googleConnectionProperties,
    propertyImportInitiators,
    destinationLookup,
  } = deps
  // The reads every route's fan-out shares; the queue decides how a job travels.
  const fanoutReads = {
    userLookup,
    responsibleManagers,
    replyApproval,
    inboxItemLookup,
    activeProperty: createActivePropertyLookup(db),
    clock,
    logger,
  }
  const notices = { noticeWriter, receipts: outboxRepo }
  registerIdentityAccountNotificationConsumers(consumerRegistry, {
    ...notices,
    displayNames,
    logger: logger,
  })
  registerNotificationConsumers(consumerRegistry, {
    ...fanoutReads,
    ...notices,
  })
  registerWorkflowNotificationConsumers(consumerRegistry, {
    ...fanoutReads,
    ...notices,
    retireMovedAssignment: createRetireMovedAssignment({
      notifications: notificationRepo,
      emails: emailRepo,
    }),
  })
  registerBulkAssignmentNotificationConsumer(consumerRegistry, {
    ...notices,
    userLookup,
    displayNames,
    logger: logger,
  })
  registerAssignmentReleaseNotificationConsumer(consumerRegistry, {
    ...notices,
    userLookup,
    responsibleManagers: responsibleManagers,
    displayNames,
    logger: logger,
  })
  registerEscalationResolutionNotificationConsumer(consumerRegistry, {
    ...notices,
    escalationResolutions,
    responsibleManagers: responsibleManagers,
    userLookup,
    notifications: notificationRepo,
    inboxItemLookup,
  })
  registerHandlingCycleNotificationConsumers(consumerRegistry, {
    ...fanoutReads,
    ...notices,
  })
  // The counterpart of the routes above: the facts that finish the work
  // they announced retire their notices and cancel the mail behind them.
  registerNotificationSettlementConsumers(consumerRegistry, {
    notifications: notificationRepo,
    groupedReopens: createGroupedReopenStore(db),
    emails: emailRepo,
    inboxItemLookup,
    workState,
    clock: clock,
    logger: logger,
    receipts: outboxRepo,
  })
  registerResponseTargetNotificationConsumer(consumerRegistry, {
    ...fanoutReads,
    ...notices,
  })
  registerGoalNotificationConsumer(consumerRegistry, {
    ...notices,
    monthlyResultFacts: monthlyResultFacts,
    responsibleManagers: responsibleManagers,
    userLookup,
    displayNames,
    logger: logger,
  })
  registerRatingGoalNoticeConsumer(consumerRegistry, {
    ...notices,
    responsibleManagers: responsibleManagers,
    userLookup,
    displayNames,
    logger: logger,
  })
  // The one notice an AI finding starts: a review analysis found a review Urgent.
  registerAiUrgentReviewNoticeConsumer(consumerRegistry, {
    ...fanoutReads,
    ...notices,
  })
  // The Monday email: a Property's Guest voice in three lines, to the managers who asked.
  registerAiGuestVoiceSummaryNoticeConsumer(consumerRegistry, {
    ...notices,
    userLookup,
    responsibleManagers: responsibleManagers,
    activeProperty: fanoutReads.activeProperty,
    displayNames,
    logger: logger,
  })
  registerPortalNotificationConsumers(consumerRegistry, {
    ...notices,
    userLookup,
    displayNames,
    logger: logger,
  })
  registerPortalDestinationNotificationConsumer(consumerRegistry, {
    noticeWriter,
    userLookup,
    destinations: destinationLookup,
    displayNames,
    logger: logger,
  })
  registerPortalHealthNotificationConsumer(consumerRegistry, {
    noticeWriter,
    responsibleManagers: responsibleManagers,
    userLookup,
    displayNames,
    logger: logger,
  })
  registerPropertyNotificationConsumers(consumerRegistry, {
    ...notices,
    userLookup,
    displayNames,
    logger: logger,
  })
  registerIntegrationNotificationConsumers(consumerRegistry, {
    ...notices,
    userLookup,
    googleConnectionProperties: googleConnectionProperties,
    logger: logger,
  })
  registerReviewImportNotificationConsumers(consumerRegistry, {
    noticeWriter,
    userLookup,
    responsibleManagers: responsibleManagers,
    inboxItemLookup,
    importInitiators: propertyImportInitiators,
    displayNames,
    logger: logger,
    clock: clock,
  })
}
