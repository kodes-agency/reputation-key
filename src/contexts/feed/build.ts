// Feed context — composition root for activity projection and notifications.
// The two dependency records preserve their former build boundaries while this
// single module exposes one merged context surface.

import type { Database } from '#/shared/db'
import { buildActivityFeed, type ActivityBuildInput } from './build-activity'
import type { ConsumerRegistry } from '#/shared/outbox'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Queue } from 'bullmq'
import { notificationId, notificationEmailId } from '#/shared/domain/ids'
import { createNotificationRepository } from './infrastructure/repositories/notification.repository'
import { createNotificationEmailRepository } from './infrastructure/repositories/notification-email.repository'
import { createNotificationPreferenceRepository } from './infrastructure/repositories/notification-preference.repository'
import { createOneClickUnsubscribeRepository } from './infrastructure/repositories/one-click-unsubscribe.repository'
import { createNotificationDbUserLookupAdapter } from './infrastructure/adapters/notification-db-user-lookup.adapter'
import type { ResponsibleManagerLookupPort } from './application/ports/responsible-manager-lookup.port'
import type {
  ReplyApprovalAuthorityPort,
  ReplyWorkStateLookupPort,
  FeedbackPortalLookupPort,
  ReviewRatingLookupPort,
} from './application/ports/cross-context-lookups.port'
import { createNotificationAudienceAuthorizer } from './application/notification-audience'
import { createNotificationRecipientStanding } from './application/notification-recipient-standing'
import { createNotificationWorkState } from './notify/settle.server'
import { createInboxItemLookupAdapter } from './infrastructure/adapters/inbox-item-lookup.adapter'
import { createDisplayNameLookupAdapter } from './infrastructure/adapters/display-name-lookup.adapter'
import { createEscalationResolutionLookupAdapter } from './infrastructure/adapters/escalation-resolution-lookup.adapter'
import type { PropertyImportInitiatorLookup } from './infrastructure/review-import-outbox-consumers'
import type { GoogleConnectionPropertyLookup } from './infrastructure/integration-outbox-consumers'
import { createAccountAccessRemovalReader } from './infrastructure/repositories/account-access-removal.repository'
import { createResendEventHandler } from './infrastructure/handlers/resend-event-handler'
import { createReviewRatingForRouting } from './infrastructure/adapters/review-rating-routing.adapter'
import { createOwnedNotificationActions } from './notify/owned-notification-actions.server'
import { createPreferenceCommands } from './preferences/preference-commands.server'
import { createImmediateEmailEnqueue } from './email/send-emails.server'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { PropertyAccessLookup } from '#/shared/domain/property-access'
import { createNotificationFeedReads } from './application/notification-feed-reads'
import type { OneClickUnsubscribeTarget } from './application/one-click-unsubscribe-token'
import { assertBetaNotificationTriggerMatrix } from './application/beta-notification-trigger-matrix'
import {
  createNotificationDeliveryProcessors,
  type NotificationDeliveryWorkerInput,
} from './infrastructure/jobs/notification-delivery-processors'
import type { MonthlyResultNotificationFactsLookup } from '#/contexts/reporting/application/public-api'
import { createNoticeWriter } from './notify/consumers.server'
import { registerNotificationRoutes } from './notify/register-routes.server'
import { createNotificationDeliveryLagRepository } from './infrastructure/repositories/notification-delivery-lag.repository'
import { NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS } from './infrastructure/repositories/health-read-timeout'
import {
  MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT,
  type IsEmailDeliveryAllowed,
} from './application/ports/notification-delivery-lag.repository'
import { createOrganizationAccountNotificationAuthority } from './infrastructure/adapters/organization-account-notification-authority.adapter'
import { createNotificationOrganizationScopeResolver } from './infrastructure/repositories/notification-organization-scope.repository'
import { createNotificationUserSettings } from './preferences/user-settings.server'
import type {
  NotificationQuietHoursInput,
  NotificationUserSettingsInput,
} from './preferences/contracts'

import type { OutboxRepository } from '#/shared/outbox'

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

  const preferenceCommands = createPreferenceCommands({
    prefRepo,
    clock: input.clock,
    idGen: input.idGen,
  })

  const ownedActions = createOwnedNotificationActions({
    notificationRepo,
    clock: input.clock,
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
    ...ownedActions,
    // Bulk actions resolve the same Property scope as the reads.
    markAllRead: feedReads.markAllRead,
    dismissAll: feedReads.dismissAll,
    getPreferences: async (userId: string, orgId: string) => ({
      preferences: await prefRepo.findByUser(userId, orgId),
      categoryDefaults: await prefRepo.findCategoryDefaults(userId, orgId),
      propertyWindows: await prefRepo.findPropertyDeliveryWindows(userId, orgId),
    }),
    getUserSettings: (userId: UserId, orgId: OrganizationId) =>
      userSettings.read(userId, orgId),
    ...preferenceCommands,
    updateQuietHours: (
      userId: UserId,
      orgId: OrganizationId,
      change: NotificationQuietHoursInput,
    ) => userSettings.saveQuietHours(userId, orgId, change),
    oneClickUnsubscribe: (target: OneClickUnsubscribeTarget) =>
      oneClickUnsubscribeRepo.apply(target, input.clock()),
    updateUserSettings: (
      userId: UserId,
      orgId: OrganizationId,
      change: NotificationUserSettingsInput,
    ) => userSettings.save(userId, orgId, change),
  } as const

  const routeDeps = {
    db: input.db,
    outboxRepo: input.outboxRepo,
    clock: input.clock,
    logger: input.logger,
    userLookup,
    displayNames,
    responsibleManagers: input.responsibleManagers,
    replyApproval: input.replyApproval,
    inboxItemLookup,
    escalationResolutions,
    notificationRepo,
    emailRepo,
    workState,
    monthlyResultFacts: input.monthlyResultFacts,
    googleConnectionProperties: input.googleConnectionProperties,
    propertyImportInitiators: input.propertyImportInitiators,
    destinationLookup: input.destinationLookup,
  } as const

  /**
   * Context-owned durable consumer registration. It is inert without the
   * worker queue, so web composition can expose the capability without
   * exposing Notification repositories or use cases.
   */
  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    if (!input.queue) return
    registerNotificationRoutes(consumerRegistry, noticeWriter, routeDeps)
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
