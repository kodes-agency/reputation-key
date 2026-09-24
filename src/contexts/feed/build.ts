// Feed context — composition root for activity projection and notifications.
// The two dependency records preserve their former build boundaries while this
// single module exposes one merged context surface.

import type { Database } from '#/shared/db'
import { createConsumerRegistry, type ConsumerRegistry } from '#/shared/outbox'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createRecentActivityRepository } from './infrastructure/recent-activity-repository.drizzle'
import { getActivityTimeline } from './queries/get-activity-timeline'
import { listRecentActivity } from './queries/list-recent-activity'
import { createDbInboxItemLookupAdapter } from './infrastructure/adapters/db-inbox-item-lookup.adapter'
import { createActivityDbUserLookupAdapter } from './infrastructure/adapters/activity-db-user-lookup.adapter'
import { createActivityDeliveryStore } from './infrastructure/activity-delivery-store'
import { registerActivityOutboxConsumers } from './infrastructure/activity-outbox-consumers'
import { createRecentActivityRecoveryRuntime } from './infrastructure/recent-activity-recovery-runtime'
import type { RecentActivityEntryId } from '#/shared/domain/ids'
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
import { createActivityProjectionRuntime } from './application/activity-projection-runtime'
import { createActivityOrganizationExportContributor } from './infrastructure/adapters/activity-organization-export.adapter'
import { createActivityOrganizationLifecycleContributor } from './infrastructure/adapters/activity-organization-lifecycle.adapter'

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
import type { FeedbackPortalLookupPort } from './application/ports/feedback-portal-lookup.port'
import { createNotificationAudienceAuthorizer } from './application/notification-audience'
import { createNotificationRecipientStanding } from './application/notification-recipient-standing'
import { createNotificationOrganizationEmailStopReader } from './infrastructure/repositories/notification-organization-email-stop.repository'
import { createInboxItemLookupAdapter } from './infrastructure/adapters/inbox-item-lookup.adapter'
import { createDisplayNameLookupAdapter } from './infrastructure/adapters/display-name-lookup.adapter'
import { createEscalationResolutionLookupAdapter } from './infrastructure/adapters/escalation-resolution-lookup.adapter'
import { registerNotificationConsumers } from './infrastructure/notification-outbox-consumers'
import { registerWorkflowNotificationConsumers } from './infrastructure/workflow-outbox-consumers'
import { registerPortalNotificationConsumers } from './infrastructure/portal-outbox-consumers'
import { registerPropertyNotificationConsumers } from './infrastructure/property-outbox-consumers'
import {
  registerIntegrationNotificationConsumers,
  type GoogleConnectionPropertyLookup,
} from './infrastructure/integration-outbox-consumers'
import { registerBulkAssignmentNotificationConsumer } from './infrastructure/bulk-assignment-outbox-consumers'
import { registerAssignmentReleaseNotificationConsumer } from './infrastructure/assignment-release-outbox-consumers'
import { registerEscalationResolutionNotificationConsumer } from './infrastructure/escalation-resolution-outbox-consumers'
import { registerGoalNotificationConsumer } from './infrastructure/goal-outbox-consumers'
import { registerHandlingCycleNotificationConsumers } from './infrastructure/handling-cycle-outbox-consumers'
import { registerNotificationSettlementConsumers } from './infrastructure/notification-settlement-outbox-consumers'
import { registerResponseTargetNotificationConsumer } from './infrastructure/response-target-outbox-consumers'
import { createAccountAccessRemovalReader } from './infrastructure/repositories/account-access-removal.repository'
import { createNotificationGapRepository } from './infrastructure/repositories/notification-gap.repository'
import { createNotificationDeliveryRepairRepository } from './infrastructure/repositories/notification-delivery-repair.repository'
import { createResendEventHandler } from './infrastructure/handlers/resend-event-handler'
import {
  createReconcileMissingNotificationsHandler,
  DEFAULT_RECONCILE_GRACE_MS,
  DEFAULT_RECONCILE_LOOKBACK_MS,
  NOTIFICATION_GAP_SCAN_LIMIT,
} from './infrastructure/jobs/reconcile-missing-notifications.job'
import { insertNotification } from './application/use-cases/insert-notification'
import { muteNotificationCategory } from './application/use-cases/mute-notification-category'
import { immediateEmailDispatch } from './infrastructure/jobs/urgent-email.job'
import { jobEnqueueOptions, withCatalogueJobOptions } from '#/shared/jobs/job-policy'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import {
  markNotificationRead,
  markNotificationUnread,
  dismissNotification,
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
import type { NotificationListFilter } from './application/notification-list-filter'
import { toNotificationView } from './application/notification-view'
import type { OneClickUnsubscribeTarget } from './application/one-click-unsubscribe-token'
import { assertBetaNotificationTriggerMatrix } from './application/beta-notification-trigger-matrix'
import { createNotificationDeliveryRuntime } from './application/notification-delivery-runtime'
import type { MonthlyResultNotificationFactsLookup } from '#/contexts/reporting/application/public-api'
import {
  withBetaOutboxNotificationDelivery,
  withDeliveryRepairJobs,
} from './infrastructure/outbox-notification-delivery'
import type { NotificationJobEnqueuePort } from './infrastructure/inbox-notification-fanout'
import { createNotificationDeliverySettlement } from './infrastructure/repositories/notification-delivery-settlement.repository'
import { createNotificationDeliveryLagRepository } from './infrastructure/repositories/notification-delivery-lag.repository'
import { NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS } from './infrastructure/repositories/health-read-timeout'
import {
  MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT,
  type IsEmailDeliveryAllowed,
} from './application/ports/notification-delivery-lag.repository'
import { registerPortalHealthNotificationConsumer } from './infrastructure/portal-health-outbox-consumers'
import { createOrganizationAccountNotificationAuthority } from './infrastructure/adapters/organization-account-notification-authority.adapter'
import {
  registerIdentityAccountNotificationConsumers,
  registerOrganizationPurgePendingNoticeConsumer,
} from './infrastructure/identity-account-outbox-consumers'
import { createNotificationOrganizationExportContributor } from './infrastructure/adapters/notification-organization-export.adapter'
import { createNotificationOrganizationLifecycleContributor } from './infrastructure/adapters/notification-organization-lifecycle.adapter'
import { createNotificationOrganizationScopeResolver } from './infrastructure/repositories/notification-organization-scope.repository'
import { createNotificationUserSettings } from './infrastructure/notification-user-settings'
import type { NotificationQuietHoursInput } from './application/dto/notification-preference.dto'
import type { NotificationUserSettingsInput } from './application/dto/notification-user-settings.dto'

import type { OutboxRepository } from '#/shared/outbox'

type ActivityBuildInput = Readonly<{
  db: Database
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  staffPublicApi: StaffPublicApi
  clock: () => Date
  logger: LoggerPort
  idGen: () => RecentActivityEntryId
  operationalHistoryAccessAuthority?: OperationalHistoryAccessAuthority
  operationalHistoryIdGen: () => OperationalActionHistoryRecordId
  operationalHistoryHoldIdGen: () => string
}>

const buildActivityFeed = (input: ActivityBuildInput) => {
  const repo = createRecentActivityRepository(input.db, input.logger)
  const inboxItemLookup = createDbInboxItemLookupAdapter(input.db)
  const userLookup = createActivityDbUserLookupAdapter(input.db)
  const deliveryStore = createActivityDeliveryStore(input.db)
  const recoveryRuntime = createRecentActivityRecoveryRuntime(input.db, input.logger)
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

  const timeline = getActivityTimeline({
    repo,
    staffPublicApi: input.staffPublicApi,
  })
  const orgActivity = listRecentActivity({
    repo,
    staffPublicApi: input.staffPublicApi,
  })

  const publicApi = {
    getActivityTimeline: timeline,
    listRecentActivity: orgActivity,
    listOperationalActionHistory: listHistory,
    exportOperationalActionHistory: exportHistory,
  }

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) =>
    registerActivityOutboxConsumers(consumerRegistry, {
      deliveryStore,
      userLookup,
      inboxItemLookup,
      clock: input.clock,
      logger: input.logger,
      idGen: input.idGen,
      operationalHistoryDeliveryStore: operationalHistoryStore,
      operationalHistoryIdGen,
    })

  // ACT-005: projectRecentActivity is NOT constructed here — bootstrap.ts owns the
  // worker-side instantiation (it has the BullMQ job handler). This build
  // function exposes query APIs and durable outbox-consumer registration.
  return {
    publicApi,
    // LIF-01-T8: Activity's Organization Export contribution. It is published
    // as its own named seam rather than through publicApi because the export is
    // an Identity-orchestrated lifecycle capability, not a manager-facing read —
    // a dark capability must not become reachable by being wired here.
    organizationExportContributor: createActivityOrganizationExportContributor(input.db),
    // LIF-01-T12/T13/T14: Activity's Organization lifecycle contribution, on
    // its own named seam for the same reason as the export contributor. Binding
    // it here does NOT make purge reachable — the coordinator still refuses to
    // run without all seventeen contributors plus independently reviewed
    // support authorization, and its worker schedule stays quarantined.
    organizationLifecycleContributor: createActivityOrganizationLifecycleContributor(
      input.db,
    ),
    // ARC-03-T12: Activity owns its projection end to end. The container used
    // to hand bootstrap the recent-activity REPOSITORY so the worker could
    // assemble this itself.
    worker: Object.freeze({
      registerOutboxConsumers,
      ...createActivityProjectionRuntime({
        repo,
        userLookup,
        clock: input.clock,
        logger: input.logger,
        idGen: input.idGen,
      }),
    }),
    internal: {
      repos: {
        recentActivityRepo: repo,
        operationalActionHistoryStore: operationalHistoryStore,
      },
      useCases: {
        getActivityTimeline: timeline,
        listRecentActivity: orgActivity,
        ...recoveryRuntime,
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
  /** Guest-owned source attribution; Notification never reads Guest tables. */
  feedbackPortalLookup: FeedbackPortalLookupPort
  googleConnectionProperties: GoogleConnectionPropertyLookup
  /** Goal-owned exact closed-and-achieved result lookup. */
  monthlyResultFacts: MonthlyResultNotificationFactsLookup
  /** Portal-owned exact current Health state fence for delayed delivery. */
  portalHealthLookup: Pick<PortalPublicApi, 'findPortalHealthNotificationFacts'>
  /**
   * Current `notification.send_email` decision per scope, so delivery-lag
   * evidence judges only mail that may be sent (composition-owned policy).
   */
  isEmailDeliveryAllowed: IsEmailDeliveryAllowed
  /** Identity-owned current Property access; the in-app feed follows it. */
  propertyAccess: PropertyAccessLookup
  /** Server secret refused email addresses are keyed with (never stored). */
  emailAddressKey: string
}>

const buildNotificationFeed = (input: NotificationBuildInput) => {
  const notificationRepo = createNotificationRepository(input.db)
  const feedReads = createNotificationFeedReads({
    repo: notificationRepo,
    propertyAccess: input.propertyAccess,
  })
  const accessRemovalReader = createAccountAccessRemovalReader(input.db)
  const gapRepo = createNotificationGapRepository(input.db)
  const deliveryRepairRepo = createNotificationDeliveryRepairRepository(input.db)
  const deliveryLagRepo = createNotificationDeliveryLagRepository(
    input.db,
    input.isEmailDeliveryAllowed,
  )
  const emailRepo = createNotificationEmailRepository(input.db, {
    emailAddressKey: input.emailAddressKey,
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
  // Asked when an email is queued, and again before it is sent.
  const organizationEmailStop = createNotificationOrganizationEmailStopReader(input.db)
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

  // Every durable delivery inherits the catalogue retry policy and records its
  // Redis-acceptance marker before the consumer acknowledges the source fact.
  const policyQueue = input.queue ? withCatalogueJobOptions(input.queue) : undefined
  const notificationDeliveryQueue = policyQueue
    ? withBetaOutboxNotificationDelivery(policyQueue, input.outboxRepo)
    : undefined
  // A repair replays a source fact through the same bridge, but queues only
  // the deliveries that never settled, each under an id of its own.
  const deliveryRepairQueue = policyQueue
    ? withBetaOutboxNotificationDelivery(
        withDeliveryRepairJobs(policyQueue, input.outboxRepo),
        input.outboxRepo,
      )
    : undefined

  // The reads every route's fan-out shares; the queue decides how a job travels.
  const fanoutReads = {
    userLookup,
    responsibleManagers: input.responsibleManagers,
    replyApproval: input.replyApproval,
    inboxItemLookup,
    clock: input.clock,
    logger: input.logger,
  }

  /**
   * The window of Inbox items the missing-notification gauge judges: old
   * enough to judge (past the grace edge) and recent enough to be news.
   */
  const gapWindow = () => {
    const now = input.clock().getTime()
    return {
      createdAtOrAfter: new Date(now - DEFAULT_RECONCILE_LOOKBACK_MS),
      createdBefore: new Date(now - DEFAULT_RECONCILE_GRACE_MS),
    }
  }

  const enqueueImmediateEmail = input.queue
    ? async (data: {
        notificationEmailId: string
        organizationId: string
        propertyId?: string
      }) => {
        const dispatch = immediateEmailDispatch(data.propertyId)
        await input.queue!.add(
          dispatch.jobName,
          {
            ...data,
            ...createJobExecutionEnvelope({
              organizationId: data.organizationId,
              ...(data.propertyId === undefined ? {} : { propertyId: data.propertyId }),
              capability: dispatch.capability,
              initiator: { kind: 'system', id: 'notification:urgent-enqueue' },
              correlationId: `notification-email:${data.notificationEmailId}`,
            }),
          },
          {
            ...jobEnqueueOptions(dispatch.jobName),
          },
        )
      }
    : undefined

  const useCases = {
    insertNotification: insertNotification({
      notificationRepo,
      emailRepo,
      preferenceRepo: prefRepo,
      clock: input.clock,
      idGen: () => notificationId(input.idGen()),
      emailIdGen: () => notificationEmailId(input.idGen()),
      logger: input.logger,
      organizationEmailStop,
      enqueueImmediateEmail,
    }),
  } as const

  // Surfaced on the container as `notificationDeliverySettlement`. It was
  // defined here but never exposed, so bootstrap built the insert-notification
  // handler without it and every outbox-delivered notification threw.
  const deliverySettlement = createNotificationDeliverySettlement({
    db: input.db,
    clock: input.clock,
    idGen: () => notificationId(input.idGen()),
    emailIdGen: () => notificationEmailId(input.idGen()),
    logger: input.logger,
    enqueueImmediateEmail,
  })

  const publicApi = {
    insertNotification: useCases.insertNotification,

    /**
     * Why the caller has no workspace, when the answer is "it was taken away".
     * The only user-scoped read in this context: the notice lives in an
     * Organization the caller can no longer open, so nothing organization-
     * scoped could ever show it to them. Its server function resolves the
     * subject from the session, never from the request body.
     */
    readAccountAccessRemoval: accessRemovalReader.findLatestForUser,

    /**
     * Feeds the `notification.missing_for_inbox_item` gauge. Exposed here
     * because `src/shared/observability/health-metrics.ts` cannot import a
     * context — the composition root injects this reader instead. PostgreSQL
     * cancels a count that outlasts its statement timeout.
     */
    readMissingNotificationCount: (): Promise<number> =>
      gapRepo.countItemsMissingNotifications({
        ...gapWindow(),
        scanLimit: NOTIFICATION_GAP_SCAN_LIMIT,
        statementTimeoutMs: NOTIFICATION_HEALTH_READ_STATEMENT_TIMEOUT_MS,
      }),

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
    findById: (id: string, orgId: string) => notificationRepo.findById(id, orgId),
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
    markAllRead: (userId: string, orgId: string, filter: NotificationListFilter) => {
      const now = input.clock()
      return notificationRepo.markAllRead(userId, orgId, filter, now)
    },
    dismissAll: (userId: string, orgId: string) => {
      const now = input.clock()
      return notificationRepo.markAllDismissed(userId, orgId, now)
    },
    dismiss: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, dismissNotification)
      if (now === null) return // invalid transition, skip
      await notificationRepo.updateStatus(id, userId, orgId, 'dismissed', now)
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
        },
        () => now,
      )
      if (result.isErr()) throw result.error
      if (!applyToAllProperties) return prefRepo.upsert(result.value)
      // "Apply to all my properties" is a statement about the person, not one
      // Property: it becomes the default a Property with no row inherits, and
      // the rows that would have overridden it go.
      const categoryDefault = createNotificationCategoryDefault(
        {
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          category: category as ConfigurableNotificationCategory,
          channel,
          enabled,
          cadence,
        },
        () => now,
      )
      if (categoryDefault.isErr()) throw categoryDefault.error
      await prefRepo.applyCategoryDefaultEverywhere(categoryDefault.value)
      return result.value
    },
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
          upsertEnabled: prefRepo.upsertEnabled,
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
    queue: NotificationJobEnqueuePort,
  ) => {
    registerIdentityAccountNotificationConsumers(consumerRegistry, {
      queue,
      receipts: input.outboxRepo,
    })
    // LIF-01 program bullet 5 — the mandatory final notice at Purge Pending.
    // Registering it does NOT arm the lifecycle: the transition that produces
    // the fact is still driven by a quarantined schedule.
    registerOrganizationPurgePendingNoticeConsumer(consumerRegistry, {
      queue,
      userLookup,
      displayNames,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerNotificationConsumers(consumerRegistry, {
      ...fanoutReads,
      queue,
      receipts: input.outboxRepo,
    })
    registerWorkflowNotificationConsumers(consumerRegistry, {
      ...fanoutReads,
      queue,
      receipts: input.outboxRepo,
    })
    registerBulkAssignmentNotificationConsumer(consumerRegistry, {
      queue,
      userLookup,
      displayNames,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerAssignmentReleaseNotificationConsumer(consumerRegistry, {
      queue,
      userLookup,
      responsibleManagers: input.responsibleManagers,
      displayNames,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerEscalationResolutionNotificationConsumer(consumerRegistry, {
      queue,
      escalationResolutions,
      responsibleManagers: input.responsibleManagers,
      userLookup,
      notifications: notificationRepo,
      receipts: input.outboxRepo,
    })
    registerHandlingCycleNotificationConsumers(consumerRegistry, {
      ...fanoutReads,
      queue,
      receipts: input.outboxRepo,
    })
    // The counterpart of the routes above: the facts that finish the work
    // they announced retire their notices and cancel the mail behind them.
    registerNotificationSettlementConsumers(consumerRegistry, {
      notifications: notificationRepo,
      emails: emailRepo,
      inboxItemLookup,
      clock: input.clock,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerResponseTargetNotificationConsumer(consumerRegistry, {
      ...fanoutReads,
      queue,
      receipts: input.outboxRepo,
    })
    registerGoalNotificationConsumer(consumerRegistry, {
      queue,
      monthlyResultFacts: input.monthlyResultFacts,
      responsibleManagers: input.responsibleManagers,
      userLookup,
      displayNames,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerPortalNotificationConsumers(consumerRegistry, {
      queue,
      userLookup,
      displayNames,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerPortalHealthNotificationConsumer(consumerRegistry, {
      queue,
      responsibleManagers: input.responsibleManagers,
      userLookup,
      displayNames,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerPropertyNotificationConsumers(consumerRegistry, {
      queue,
      userLookup,
      displayNames,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerIntegrationNotificationConsumers(consumerRegistry, {
      queue,
      userLookup,
      googleConnectionProperties: input.googleConnectionProperties,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
  }

  /**
   * Context-owned durable consumer registration. It is inert without the
   * worker queue, so web composition can expose the capability without
   * exposing Notification repositories or use cases.
   */
  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    if (!notificationDeliveryQueue) return
    registerNotificationRoutes(consumerRegistry, notificationDeliveryQueue)
    // Executable readiness contract: compare the beta trigger/recipient
    // matrix with the consumers that are actually present in this worker.
    // ARC-03-T7: read the registry this container just registered into — a
    // process-global read would let one container's matrix pass on another
    // container's consumers.
    assertBetaNotificationTriggerMatrix(consumerRegistry.list())
  }

  /**
   * The repair replays a source fact through the route's own consumer, bound
   * here to the delivery-repair queue. This registry is private: the outbox
   * dispatcher never reads it.
   */
  const reconcileMissingNotificationsHandler = () => {
    if (!deliveryRepairQueue) return undefined
    const routes = createConsumerRegistry()
    registerNotificationRoutes(routes, deliveryRepairQueue)
    return createReconcileMissingNotificationsHandler({
      deliveries: deliveryRepairRepo,
      routes,
      clock: input.clock,
      logger: input.logger,
    })
  }

  return {
    publicApi,
    // LIF-01-T8: Notification's Organization Export contribution. It is
    // published as its own named seam rather than through publicApi because the
    // export is an Identity-orchestrated lifecycle capability, not a
    // manager-facing read.
    organizationExportContributor: createNotificationOrganizationExportContributor(
      input.db,
    ),
    // LIF-01-T12/T13/T14: Notification's Organization lifecycle contribution,
    // on its own named seam for the same reason as the export contributor.
    // Closing stops delivery, which is the highest-risk external effect in the
    // whole closure. Binding it here does NOT make purge reachable — the
    // coordinator still refuses to run without all seventeen contributors plus
    // independently reviewed support authorization, and its worker schedule
    // stays quarantined.
    organizationLifecycleContributor: createNotificationOrganizationLifecycleContributor(
      input.db,
    ),
    worker: Object.freeze({ registerOutboxConsumers }),
    // ARC-03-T12: one named delivery capability replaces the root's reach into
    // Notification's private repository trio and loose handlers.
    delivery: createNotificationDeliveryRuntime({
      repos: { notificationRepo, emailRepo, preferenceRepo: prefRepo },
      handlers: {
        handleResendEvent,
        authorizeAudience,
        recipientStanding,
        deliverySettlement,
        reconcileMissingNotificationsHandler: reconcileMissingNotificationsHandler(),
      },
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
