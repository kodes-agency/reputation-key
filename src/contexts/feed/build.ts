// Feed context — composition root for activity projection and notifications.
// The two dependency records preserve their former build boundaries while this
// single module exposes one merged context surface.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createRecentActivityRepository } from './infrastructure/recent-activity-repository.drizzle'
import { registerActivityOutboxConsumers } from './infrastructure/activity-outbox-consumers'
import type { OperationalActionHistoryRecordId } from './domain/operational-action-history'
import { createOperationalActionHistoryStore } from './infrastructure/operational-action-history-store'
import { createRecentActivityPrivacyStore } from './infrastructure/recent-activity-privacy-store'
import { redactRecentActivityActorLabels } from './application/use-cases/redact-recent-activity-actor-labels'
import {
  exportOperationalActionHistory,
  listOperationalActionHistory,
  type OperationalHistoryAccessAuthority,
} from './application/use-cases/operational-action-history-access'
import {
  appendOperationalAction,
  assessOperationalActionHistoryRetention,
  getOperationalActionHistoryReadiness,
  placeOperationalActionHistoryLegalHold,
  redactOperationalActionHistorySubject,
  releaseOperationalActionHistoryLegalHold,
} from './application/use-cases/operational-action-history-lifecycle'

import type { Queue } from 'bullmq'
import {
  notificationId,
  notificationEmailId,
  notificationPreferenceId,
} from '#/shared/domain/ids'
import { createNotificationRepository } from './infrastructure/repositories/notification.repository'
import { createNotificationEmailRepository } from './infrastructure/repositories/notification-email.repository'
import { createNotificationPreferenceRepository } from './infrastructure/repositories/notification-preference.repository'
import { createOneClickUnsubscribeRepository } from './infrastructure/repositories/one-click-unsubscribe.repository'
import { createNotificationDbUserLookupAdapter } from './infrastructure/adapters/notification-db-user-lookup.adapter'
import type { ResponsibleManagerLookupPort } from './application/ports/responsible-manager-lookup.port'
import type { ReplyApprovalAuthorityPort } from './application/ports/reply-approval-authority.port'
import type { ReplyWorkStateLookupPort } from './application/ports/reply-work-state.port'
import type { FeedbackPortalLookupPort } from './application/ports/feedback-portal-lookup.port'
import { createNotificationAudienceAuthorizer } from './application/notification-audience'
import { createNotificationRecipientStanding } from './application/notification-recipient-standing'
import { createGroupedReopenStore } from './infrastructure/repositories/notification-grouped-reopen.repository'
import { createActivePropertyLookup } from './infrastructure/repositories/active-property'
import { createNotificationWorkState } from './application/notification-work-state'
import { createInboxItemLookupAdapter } from './infrastructure/adapters/inbox-item-lookup.adapter'
import { createDisplayNameLookupAdapter } from './infrastructure/adapters/display-name-lookup.adapter'
import { createEscalationResolutionLookupAdapter } from './infrastructure/adapters/escalation-resolution-lookup.adapter'
import { registerNotificationConsumers } from './infrastructure/notification-outbox-consumers'
import { registerWorkflowNotificationConsumers } from './infrastructure/workflow-outbox-consumers'
import { createRetireMovedAssignment } from './application/retire-moved-assignment'
import { registerPortalNotificationConsumers } from './infrastructure/portal-outbox-consumers'
import { registerPortalDestinationNotificationConsumer } from './infrastructure/portal-destination-outbox-consumers'
import { registerPropertyNotificationConsumers } from './infrastructure/property-outbox-consumers'
import {
  registerReviewImportNotificationConsumers,
  type PropertyImportInitiatorLookup,
} from './infrastructure/review-import-outbox-consumers'
import {
  registerIntegrationNotificationConsumers,
  type GoogleConnectionPropertyLookup,
} from './infrastructure/integration-outbox-consumers'
import {
  registerAssignmentReleaseNotificationConsumer,
  registerBulkAssignmentNotificationConsumer,
  registerEscalationResolutionNotificationConsumer,
  registerResponseTargetNotificationConsumer,
} from './infrastructure/inbox-notice-routes'
import { registerGoalNotificationConsumer } from './infrastructure/goal-notice-routes'
import { registerAiGuestVoiceSummaryNoticeConsumer } from './infrastructure/goal-notice-routes'
import { registerAiUrgentReviewNoticeConsumer } from './infrastructure/goal-notice-routes'
import { registerRatingGoalNoticeConsumer } from './infrastructure/goal-notice-routes'
import { registerHandlingCycleNotificationConsumers } from './infrastructure/handling-cycle-outbox-consumers'
import { registerNotificationSettlementConsumers } from './infrastructure/notification-settlement-outbox-consumers'
import { createAccountAccessRemovalReader } from './infrastructure/repositories/account-access-removal.repository'
import { createResendEventHandler } from './infrastructure/handlers/resend-event-handler'
import type { ReviewRatingLookupPort } from './application/ports/review-rating-lookup.port'
import type { LowRatingThreshold } from './domain/notification-low-ratings'
import { createReviewRatingForRouting } from './infrastructure/adapters/review-rating-routing.adapter'
import {
  muteNotificationCategory,
  undoNotificationCategoryMute,
  type PreviousPropertySetting,
} from './preferences/mute-category.server'
import { createImmediateEmailEnqueue } from './email/send-emails.server'
import {
  markNotificationRead,
  markNotificationUnread,
  dismissNotification,
  restoreDismissedNotification,
} from './domain/constructors-transitions'
import {
  createNotificationCategoryDefault,
  createNotificationPreference,
} from './domain/constructors-preference'
import { notificationError } from './domain/notification-errors'
import type {
  ConfigurableNotificationCategory,
  Notification,
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
} from './domain/notification-types'
import type { NotificationError } from './domain/notification-errors'
import type { Result } from '#/shared/domain'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { PropertyAccessLookup } from '#/shared/domain/property-access'
import { createNotificationFeedReads } from './application/notification-feed-reads'
import { toNotificationView } from './application/notification-view'
import type { OneClickUnsubscribeTarget } from './application/one-click-unsubscribe-token'
import { assertBetaNotificationTriggerMatrix } from './application/beta-notification-trigger-matrix'
import {
  createNotificationDeliveryProcessors,
  type NotificationDeliveryWorkerInput,
} from './infrastructure/jobs/notification-delivery-processors'
import type { MonthlyResultNotificationFactsLookup } from '#/contexts/reporting/application/public-api'
import { createNoticeWriter, type NoticeWriter } from './notify/consumers.server'
import { createNotificationDeliveryLagRepository } from './infrastructure/repositories/notification-delivery-lag.repository'
import { NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS } from './infrastructure/repositories/health-read-timeout'
import {
  MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT,
  type IsEmailDeliveryAllowed,
} from './application/ports/notification-delivery-lag.repository'
import { registerPortalHealthNotificationConsumer } from './infrastructure/portal-health-outbox-consumers'
import { createOrganizationAccountNotificationAuthority } from './infrastructure/adapters/organization-account-notification-authority.adapter'
import { registerIdentityAccountNotificationConsumers } from './infrastructure/identity-account-outbox-consumers'
import { createNotificationOrganizationScopeResolver } from './infrastructure/repositories/notification-organization-scope.repository'
import { createNotificationUserSettings } from './preferences/user-settings.server'
import type {
  NotificationQuietHoursInput,
  NotificationUserSettingsInput,
} from './preferences/contracts'

import type { OutboxRepository } from '#/shared/outbox'

type ActivityBuildInput = Readonly<{
  db: Database
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  clock: () => Date
  logger: LoggerPort
  operationalHistoryAccessAuthority?: OperationalHistoryAccessAuthority
  operationalHistoryIdGen: () => OperationalActionHistoryRecordId
  operationalHistoryHoldIdGen: () => string
}>

const buildActivityFeed = (input: ActivityBuildInput) => {
  const repo = createRecentActivityRepository(input.db)
  const privacyStore = createRecentActivityPrivacyStore(input.db)
  const operationalHistoryStore = createOperationalActionHistoryStore(input.db)
  const operationalHistoryIdGen = input.operationalHistoryIdGen
  const operationalHistoryLifecycle = {
    store: operationalHistoryStore,
    clock: input.clock,
    idGen: operationalHistoryIdGen,
    holdIdGen: input.operationalHistoryHoldIdGen,
  }
  const operationalHistoryAccess = {
    store: operationalHistoryStore,
    accessAuthority:
      input.operationalHistoryAccessAuthority ??
      ({ isCurrentAccountAdmin: async () => false } as const),
    clock: input.clock,
    idGen: operationalHistoryIdGen,
  }
  const listHistory = listOperationalActionHistory(operationalHistoryAccess)
  const exportHistory = exportOperationalActionHistory(operationalHistoryAccess)

  const publicApi = {
    listOperationalActionHistory: listHistory,
    exportOperationalActionHistory: exportHistory,
  }

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) =>
    registerActivityOutboxConsumers(consumerRegistry, {
      clock: input.clock,
      operationalHistoryDeliveryStore: operationalHistoryStore,
      operationalHistoryIdGen,
    })

  return {
    publicApi,
    worker: Object.freeze({ registerOutboxConsumers }),
    internal: {
      repos: {
        recentActivityRepo: repo,
        operationalActionHistoryStore: operationalHistoryStore,
      },
      useCases: {
        redactRecentActivityActorLabels: redactRecentActivityActorLabels({
          store: privacyStore,
          clock: input.clock,
        }),
        listOperationalActionHistory: listHistory,
        exportOperationalActionHistory: exportHistory,
        appendOperationalAction: appendOperationalAction({
          store: operationalHistoryStore,
          clock: input.clock,
          idGen: operationalHistoryIdGen,
        }),
        getOperationalActionHistoryReadiness: getOperationalActionHistoryReadiness({
          store: operationalHistoryStore,
        }),
        assessOperationalActionHistoryRetention: assessOperationalActionHistoryRetention(
          operationalHistoryLifecycle,
        ),
        placeOperationalActionHistoryLegalHold: placeOperationalActionHistoryLegalHold(
          operationalHistoryLifecycle,
        ),
        releaseOperationalActionHistoryLegalHold:
          releaseOperationalActionHistoryLegalHold(operationalHistoryLifecycle),
        redactOperationalActionHistorySubject: redactOperationalActionHistorySubject(
          operationalHistoryLifecycle,
        ),
      },
    },
  } as const
}

const NOTIFICATION_DELIVERY_LAG_GRACE_MS = 60_000
const NOTIFICATION_DELIVERY_LAG_LOOKBACK_MS = 24 * 60 * 60 * 1000
const NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT = MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT

type NotificationBuildInput = Readonly<{
  db: Database
  outboxRepo: OutboxRepository
  queue: Queue | undefined
  clock: () => Date
  idGen: () => string
  logger: LoggerPort
  /** Current, eligibility-filtered Property/Portal notification authorities. */
  responsibleManagers: ResponsibleManagerLookupPort
  /** Identity-owned `reply.manage` authority, for routing approval requests. */
  replyApproval: ReplyApprovalAuthorityPort
  /** Review-owned reply status, so a notice never asks for a decided reply. */
  replyStates: ReplyWorkStateLookupPort
  /**
   * Review-owned eligible rating, read only to route a review's notice as a
   * Low ratings one; never stored (ADR 0046 amended 2026-09-30, ADR 0031).
   */
  reviewRatings: ReviewRatingLookupPort
  /** Guest-owned source attribution; Notification never reads Guest tables. */
  feedbackPortalLookup: FeedbackPortalLookupPort
  googleConnectionProperties: GoogleConnectionPropertyLookup
  /** Integration-owned answer to who asked for a Property's Google import. */
  propertyImportInitiators: PropertyImportInitiatorLookup
  /** Goal-owned exact closed-and-achieved result lookup. */
  monthlyResultFacts: MonthlyResultNotificationFactsLookup
  /** Portal-owned exact current Health state fence for delayed delivery. */
  portalHealthLookup: Pick<PortalPublicApi, 'findPortalHealthNotificationFacts'>
  /** Portal-owned state of a site waiting for approval, and the Portal to open. */
  destinationLookup: Pick<PortalPublicApi, 'findDestinationApprovalNotificationFacts'>
  /**
   * Current `notification.send_email` decision per scope, so delivery-lag
   * evidence judges only mail that may be sent (composition-owned policy).
   */
  isEmailDeliveryAllowed: IsEmailDeliveryAllowed
  /** Identity-owned current Property access; the in-app feed follows it. */
  propertyAccess: PropertyAccessLookup
  /** Server secret refused email addresses are keyed with (never stored). */
  emailAddressKey: string
  /** Keys refused addresses may still be stored under while they move. */
  retiredEmailAddressKeys?: readonly string[]
}>

const buildNotificationFeed = (input: NotificationBuildInput) => {
  const notificationRepo = createNotificationRepository(input.db)
  const feedReads = createNotificationFeedReads({
    repo: notificationRepo,
    propertyAccess: input.propertyAccess,
    clock: input.clock,
  })
  const accessRemovalReader = createAccountAccessRemovalReader(input.db)
  const deliveryLagRepo = createNotificationDeliveryLagRepository(
    input.db,
    input.isEmailDeliveryAllowed,
  )
  const emailRepo = createNotificationEmailRepository(input.db, {
    emailAddressKey: input.emailAddressKey,
    retiredEmailAddressKeys: input.retiredEmailAddressKeys,
  })
  const prefRepo = createNotificationPreferenceRepository(input.db)
  const oneClickUnsubscribeRepo = createOneClickUnsubscribeRepository(input.db)
  // ADR 0046 r.3: the settings page and every timestamp read the same
  // user-then-Organization zone the delivery jobs resolve. The pool is read at
  // call time: composition must not touch the database while it is built.
  const userSettings = createNotificationUserSettings({
    preferenceRepo: prefRepo,
    resolveOrganizationScope: (organizationId) =>
      createNotificationOrganizationScopeResolver(input.db.$client)(organizationId),
    clock: input.clock,
  })
  const userLookup = createNotificationDbUserLookupAdapter(input.db)
  const handleResendEvent = createResendEventHandler({
    emailRepo,
    userLookup,
    logger: input.logger,
  })
  const inboxItemLookup = createInboxItemLookupAdapter(
    input.db,
    input.feedbackPortalLookup,
  )
  const displayNames = createDisplayNameLookupAdapter(input.db)
  const escalationResolutions = createEscalationResolutionLookupAdapter(input.db)
  const organizationAccountAuthority = createOrganizationAccountNotificationAuthority(
    input.db,
  )
  const authorizeAudience = createNotificationAudienceAuthorizer({
    userLookup,
    responsibleManagers: input.responsibleManagers,
    replyApproval: input.replyApproval,
    notifications: notificationRepo,
    inboxItemLookup,
    escalationResolutions,
    portalHealthLookup: input.portalHealthLookup,
    monthlyResultFacts: input.monthlyResultFacts,
    organizationAccountAuthority,
  })
  // Asked before a notice is written, before its email leaves, and before a
  // settling fact retires it: the owners' answer to "is the work still waiting".
  const workState = createNotificationWorkState({
    escalationResolutions,
    inboxItemLookup,
    replyStates: input.replyStates,
    portalHealthLookup: input.portalHealthLookup,
    destinationLookup: input.destinationLookup,
    responsibleManagers: input.responsibleManagers,
  })
  // Asked again immediately before every Property-scoped email is sent.
  const recipientStanding = createNotificationRecipientStanding({
    userLookup,
    responsibleManagers: input.responsibleManagers,
    replyApproval: input.replyApproval,
  })

  /**
   * The guard every single-notification mutation shares: load the row, prove
   * it belongs to the caller, then apply the domain transition. Returns the
   * transition's timestamp, or null when the transition is a no-op so the
   * caller skips its write. A wrong or foreign id throws `not_found`.
   *
   * Factored because these three paths MUST NOT drift: an ownership check
   * present in two of them and missing from the third is a cross-tenant write,
   * and that is exactly the kind of difference three near-identical inline
   * copies hide.
   */
  const applyOwnedTransition = async (
    id: string,
    orgId: string,
    userId: UserId,
    transition: (
      notification: Notification,
      clock: () => Date,
    ) => Result<Notification, NotificationError>,
  ): Promise<Date | null> => {
    const n = await notificationRepo.findById(id, orgId)
    if (!n || n.userId !== userId) {
      throw notificationError('not_found', 'Notification not found or access denied')
    }
    const now = input.clock()
    return transition(n, () => now).isErr() ? null : now
  }

  // The reads every route's fan-out shares; the queue decides how a job travels.
  const fanoutReads = {
    userLookup,
    responsibleManagers: input.responsibleManagers,
    replyApproval: input.replyApproval,
    inboxItemLookup,
    activeProperty: createActivePropertyLookup(input.db),
    clock: input.clock,
    logger: input.logger,
  }

  const enqueueImmediateEmail = input.queue
    ? createImmediateEmailEnqueue(input.queue, 'notification:urgent-enqueue')
    : undefined
  const ratingForRouting = createReviewRatingForRouting(input.db, input.reviewRatings)

  // The consumer routes write their notices in the transaction that claims
  // their receipt.
  const noticeWriter = createNoticeWriter({
    db: input.db,
    clock: input.clock,
    idGen: () => notificationId(input.idGen()),
    emailIdGen: () => notificationEmailId(input.idGen()),
    logger: input.logger,
    ratingForRouting,
    enqueueImmediateEmail,
    authorizeAudience,
    workState,
  })

  const publicApi = {
    /**
     * Why the caller has no workspace, when the answer is "it was taken away".
     * The only user-scoped read in this context: the notice lives in an
     * Organization the caller can no longer open, so nothing organization-
     * scoped could ever show it to them. Its server function resolves the
     * subject from the session, never from the request body.
     */
    readAccountAccessRemoval: accessRemovalReader.findLatestForUser,

    /**
     * Payload-free evidence for durable-source→Redis and Redis→Postgres
     * materialization lag and immediate-email acceptance. The one-minute
     * grace is the accepted healthy in-app target. What bounds the read: the
     * 24-hour lower bound keeps it off historical rows, each stage's sample
     * stops at the scan limit, each email's source is one outbox primary-key
     * lookup, and PostgreSQL cancels any statement that outlasts the statement
     * timeout. The row bounds alone did not bound its time: the source join
     * once compared `id::text` and walked each Organization's whole outbox
     * per email.
     */
    readNotificationDeliveryLag: () => {
      const now = input.clock().getTime()
      return deliveryLagRepo.read({
        recordedAtOrAfter: new Date(now - NOTIFICATION_DELIVERY_LAG_LOOKBACK_MS),
        recordedBefore: new Date(now - NOTIFICATION_DELIVERY_LAG_GRACE_MS),
        scanLimit: NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT,
        statementTimeoutMs: NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS,
      })
    },

    // Query methods exposed for server functions
    // Feed reads resolve the reader's current Property access themselves.
    getFeedHead: feedReads.getFeedHead,
    getNotifications: feedReads.getNotifications,
    markRead: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, markNotificationRead)
      if (now === null) return // invalid transition, skip
      await notificationRepo.markRead(id, userId, orgId, now, now)
    },
    /**
     * Read -> unread for the row menu. Resolves to the flipped row's browser view, or
     * null when the flip is a no-op: either the transition is invalid (the row
     * is already unread or was dismissed) or ADR 0046 r.2's unread-uniqueness
     * key is already held by another row for the same (user, type, resource) —
     * in which case that row IS the user's unread signal and there is nothing
     * to do. A wrong or foreign id still throws `not_found`.
     */
    markUnread: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, markNotificationUnread)
      if (now === null) return null // invalid transition, skip
      const flipped = await notificationRepo.markUnread(id, userId, orgId, now)
      return flipped === null ? null : toNotificationView(flipped)
    },
    // Bulk actions resolve the same Property scope as the reads.
    markAllRead: feedReads.markAllRead,
    dismissAll: feedReads.dismissAll,
    dismiss: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, dismissNotification)
      if (now === null) return // invalid transition, skip
      await notificationRepo.updateStatus(id, userId, orgId, 'dismissed', now)
    },
    /**
     * The undo a dismissal offers: the row comes back as it was, read or
     * unread. Resolves to its browser view, or null when there is nothing to
     * undo (it was not dismissed, or a dismiss-all already moved on). A wrong
     * or foreign id still throws `not_found`.
     */
    restore: async (id: string, orgId: string, userId: UserId) => {
      const notification = await notificationRepo.findById(id, orgId)
      if (!notification || notification.userId !== userId) {
        throw notificationError('not_found', 'Notification not found or access denied')
      }
      const restored = restoreDismissedNotification(notification, input.clock)
      if (restored.isErr()) return null
      const row = await notificationRepo.restoreDismissed(
        id,
        userId,
        orgId,
        restored.value.status === 'unread' ? 'unread' : 'read',
        restored.value.updatedAt,
      )
      return row === null ? null : toNotificationView(row)
    },
    getPreferences: async (userId: string, orgId: string) => ({
      preferences: await prefRepo.findByUser(userId, orgId),
      categoryDefaults: await prefRepo.findCategoryDefaults(userId, orgId),
      propertyWindows: await prefRepo.findPropertyDeliveryWindows(userId, orgId),
    }),
    getUserSettings: (userId: UserId, orgId: OrganizationId) =>
      userSettings.read(userId, orgId),
    updatePreference: async (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
      enabled: boolean,
      cadence: NotificationCadence,
      applyToAllProperties: boolean,
      /** Low ratings only: "N★ or lower". */
      maxRating: LowRatingThreshold | null = null,
    ) => {
      const now = input.clock()
      const result = createNotificationPreference(
        {
          id: notificationPreferenceId(input.idGen()),
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          propertyId: propertyId as PropertyId,
          category,
          channel,
          enabled,
          cadence,
          maxRating,
        },
        () => now,
      )
      if (result.isErr()) throw result.error
      if (!applyToAllProperties) return prefRepo.upsert(result.value)
      // "Make this my default" is a statement about the person, not one
      // Property: it becomes the default every Property without its own row
      // inherits. Other Properties' own rows stay (D7).
      const categoryDefault = createNotificationCategoryDefault(
        {
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          category: category as ConfigurableNotificationCategory,
          channel,
          enabled,
          cadence,
          maxRating,
        },
        () => now,
      )
      if (categoryDefault.isErr()) throw categoryDefault.error
      await prefRepo.saveCategoryDefault(categoryDefault.value, propertyId)
      return result.value
    },
    /** Resets one Property's own settings for a category to the person's default. */
    resetPropertyCategory: (
      userId: string,
      orgId: string,
      propertyId: string,
      category: ConfigurableNotificationCategory,
    ) =>
      prefRepo.resetPropertyCategory(
        userId as UserId,
        orgId as OrganizationId,
        propertyId,
        category,
      ),
    updateQuietHours: (
      userId: UserId,
      orgId: OrganizationId,
      change: NotificationQuietHoursInput,
    ) => userSettings.saveQuietHours(userId, orgId, change),
    mutePreferenceCategory: (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
    ) =>
      muteNotificationCategory(
        {
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          propertyId: propertyId as PropertyId,
          category,
          channel,
        },
        {
          newId: () => notificationPreferenceId(input.idGen()),
          clock: input.clock,
          findPropertyPreference: prefRepo.findPropertyPreference,
          upsertEnabled: prefRepo.upsertEnabled,
        },
      ),
    /** The bell's Undo for a mute: puts back what the mute replaced. */
    undoMutePreferenceCategory: (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
      previous: PreviousPropertySetting,
    ) =>
      undoNotificationCategoryMute(
        {
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          propertyId: propertyId as PropertyId,
          category,
          channel,
          previous,
        },
        {
          newId: () => notificationPreferenceId(input.idGen()),
          clock: input.clock,
          upsertEnabled: prefRepo.upsertEnabled,
          deletePropertyPreference: prefRepo.deletePropertyPreference,
        },
      ),
    oneClickUnsubscribe: (target: OneClickUnsubscribeTarget) =>
      oneClickUnsubscribeRepo.apply(target, input.clock()),
    updateUserSettings: (
      userId: UserId,
      orgId: OrganizationId,
      change: NotificationUserSettingsInput,
    ) => userSettings.save(userId, orgId, change),
  } as const

  /** Every durable notification route, enqueueing through `queue`. */
  const registerNotificationRoutes = (
    consumerRegistry: ConsumerRegistry,
    noticeWriter: NoticeWriter,
  ) => {
    const notices = { noticeWriter, receipts: input.outboxRepo }
    registerIdentityAccountNotificationConsumers(consumerRegistry, {
      ...notices,
      displayNames,
      logger: input.logger,
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
      logger: input.logger,
    })
    registerAssignmentReleaseNotificationConsumer(consumerRegistry, {
      ...notices,
      userLookup,
      responsibleManagers: input.responsibleManagers,
      displayNames,
      logger: input.logger,
    })
    registerEscalationResolutionNotificationConsumer(consumerRegistry, {
      ...notices,
      escalationResolutions,
      responsibleManagers: input.responsibleManagers,
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
      groupedReopens: createGroupedReopenStore(input.db),
      emails: emailRepo,
      inboxItemLookup,
      workState,
      clock: input.clock,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerResponseTargetNotificationConsumer(consumerRegistry, {
      ...fanoutReads,
      ...notices,
    })
    registerGoalNotificationConsumer(consumerRegistry, {
      ...notices,
      monthlyResultFacts: input.monthlyResultFacts,
      responsibleManagers: input.responsibleManagers,
      userLookup,
      displayNames,
      logger: input.logger,
    })
    registerRatingGoalNoticeConsumer(consumerRegistry, {
      ...notices,
      responsibleManagers: input.responsibleManagers,
      userLookup,
      displayNames,
      logger: input.logger,
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
      responsibleManagers: input.responsibleManagers,
      activeProperty: fanoutReads.activeProperty,
      displayNames,
      logger: input.logger,
    })
    registerPortalNotificationConsumers(consumerRegistry, {
      ...notices,
      userLookup,
      displayNames,
      logger: input.logger,
    })
    registerPortalDestinationNotificationConsumer(consumerRegistry, {
      noticeWriter,
      userLookup,
      destinations: input.destinationLookup,
      displayNames,
      logger: input.logger,
    })
    registerPortalHealthNotificationConsumer(consumerRegistry, {
      noticeWriter,
      responsibleManagers: input.responsibleManagers,
      userLookup,
      displayNames,
      logger: input.logger,
    })
    registerPropertyNotificationConsumers(consumerRegistry, {
      ...notices,
      userLookup,
      displayNames,
      logger: input.logger,
    })
    registerIntegrationNotificationConsumers(consumerRegistry, {
      ...notices,
      userLookup,
      googleConnectionProperties: input.googleConnectionProperties,
      logger: input.logger,
    })
    registerReviewImportNotificationConsumers(consumerRegistry, {
      noticeWriter,
      userLookup,
      responsibleManagers: input.responsibleManagers,
      inboxItemLookup,
      importInitiators: input.propertyImportInitiators,
      displayNames,
      logger: input.logger,
      clock: input.clock,
    })
  }

  /**
   * Context-owned durable consumer registration. It is inert without the
   * worker queue, so web composition can expose the capability without
   * exposing Notification repositories or use cases.
   */
  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    if (!input.queue) return
    registerNotificationRoutes(consumerRegistry, noticeWriter)
    // Executable readiness contract: compare the beta trigger/recipient
    // matrix with the consumers that are actually present in this worker.
    // ARC-03-T7: read the registry this container just registered into — a
    // process-global read would let one container's matrix pass on another
    // container's consumers.
    assertBetaNotificationTriggerMatrix(consumerRegistry.list())
  }

  return {
    publicApi,
    worker: Object.freeze({ registerOutboxConsumers }),
    delivery: Object.freeze({
      repos: Object.freeze({ notificationRepo, emailRepo, preferenceRepo: prefRepo }),
      handleResendEvent,
      authorizeAudience,
      recipientStanding,
      workState,
      noticeWriter,
      ratingForRouting,
      /** Builds the worker's insert, email and digest processors. */
      createProcessors: (worker: NotificationDeliveryWorkerInput) =>
        createNotificationDeliveryProcessors(
          {
            notificationRepo,
            emailRepo,
            preferenceRepo: prefRepo,
            userLookup,
            recipientStanding,
            workState,
            noticeWriter,
            clock: input.clock,
            logger: input.logger,
          },
          worker,
        ),
    }),
  } as const
}

type BuildInput = Readonly<{
  activity: ActivityBuildInput
  notification: NotificationBuildInput
}>

export const buildFeedContext = (input: BuildInput) => {
  const activity = buildActivityFeed(input.activity)
  const notification = buildNotificationFeed(input.notification)

  return Object.freeze({
    publicApi: Object.freeze({
      ...activity.publicApi,
      ...notification.publicApi,
    }),
    activity,
    notification,
  } as const)
}
