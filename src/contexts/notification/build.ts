// Notification context — composition root
// Per architecture: factory pattern `buildNotificationContext(deps)` returning publicApi + internal.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  notificationId,
  notificationEmailId,
  notificationPreferenceId,
} from '#/shared/domain/ids'
import { createNotificationRepository } from './infrastructure/repositories/notification.repository'
import { createNotificationEmailRepository } from './infrastructure/repositories/notification-email.repository'
import { createNotificationPreferenceRepository } from './infrastructure/repositories/notification-preference.repository'
import { createOneClickUnsubscribeRepository } from './infrastructure/repositories/one-click-unsubscribe.repository'
import { createDbUserLookupAdapter } from './infrastructure/adapters/db-user-lookup.adapter'
import type { ResponsibleManagerLookupPort } from './application/ports/responsible-manager-lookup.port'
import type { FeedbackPortalLookupPort } from './application/ports/feedback-portal-lookup.port'
import { createNotificationAudienceAuthorizer } from './application/notification-audience'
import { createInboxItemLookupAdapter } from './infrastructure/adapters/inbox-item-lookup.adapter'
import { createEscalationResolutionLookupAdapter } from './infrastructure/adapters/escalation-resolution-lookup.adapter'
import { registerNotificationHandlers } from './infrastructure/event-handlers'
import { registerNotificationConsumers } from './infrastructure/outbox-consumers'
import { registerWorkflowNotificationConsumers } from './infrastructure/workflow-outbox-consumers'
import { registerPortalNotificationConsumers } from './infrastructure/portal-outbox-consumers'
import { registerPortalNotificationHandlers } from './infrastructure/event-handlers/portal-event-handlers'
import { registerPropertyNotificationHandlers } from './infrastructure/event-handlers/property-event-handlers'
import { registerPropertyNotificationConsumers } from './infrastructure/property-outbox-consumers'
import { registerIntegrationNotificationConsumers } from './infrastructure/integration-outbox-consumers'
import { registerBulkAssignmentNotificationConsumer } from './infrastructure/bulk-assignment-outbox-consumers'
import { registerEscalationResolutionNotificationConsumer } from './infrastructure/escalation-resolution-outbox-consumers'
import { registerGoalNotificationConsumer } from './infrastructure/goal-outbox-consumers'
import { registerHandlingCycleNotificationConsumers } from './infrastructure/handling-cycle-outbox-consumers'
import { registerResponseTargetNotificationConsumer } from './infrastructure/response-target-outbox-consumers'
import type { GoogleConnectionPropertyLookup } from './infrastructure/event-handlers/on-google-reauthorization-required'
import { createNotificationGapRepository } from './infrastructure/repositories/notification-gap.repository'
import { createResendEventHandler } from './infrastructure/handlers/resend-event-handler'
import {
  createReconcileMissingNotificationsHandler,
  DEFAULT_RECONCILE_GRACE_MS,
  DEFAULT_RECONCILE_LOOKBACK_MS,
  NOTIFICATION_GAP_SCAN_LIMIT,
} from './infrastructure/jobs/reconcile-missing-notifications.job'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { insertNotification } from './application/use-cases/insert-notification'
import { muteNotificationCategory } from './application/use-cases/mute-notification-category'
import { URGENT_EMAIL_JOB_NAME } from './infrastructure/jobs/urgent-email.job'
import { jobEnqueueOptions, withCatalogueJobOptions } from '#/shared/jobs/job-policy'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import {
  markNotificationRead,
  markNotificationUnread,
  dismissNotification,
} from './domain/constructors-transitions'
import { createNotificationPreference } from './domain/constructors-preference'
import { notificationError } from './domain/errors'
import type {
  Notification,
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
} from './domain/types'
import type { NotificationError } from './domain/errors'
import type { Result } from '#/shared/domain'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { NotificationListFilter } from './application/notification-list-filter'
import type { OneClickUnsubscribeTarget } from './application/one-click-unsubscribe-token'
import { assertBetaNotificationTriggerMatrix } from './application/beta-notification-trigger-matrix'
import { createNotificationDeliveryRuntime } from './application/notification-delivery-runtime'
import type { MonthlyResultNotificationFactsLookup } from '#/contexts/goal/application/public-api'
import { withBetaOutboxNotificationDelivery } from './infrastructure/outbox-notification-delivery'
import { createNotificationDeliverySettlement } from './infrastructure/repositories/notification-delivery-settlement.repository'
import { createNotificationDeliveryLagRepository } from './infrastructure/repositories/notification-delivery-lag.repository'
import { MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT } from './application/ports/notification-delivery-lag.repository'
import type { PortalHealthLookupPort } from './application/ports/portal-health-lookup.port'
import { registerPortalHealthNotificationConsumer } from './infrastructure/portal-health-outbox-consumers'
import { createOrganizationAccountNotificationAuthority } from './infrastructure/adapters/organization-account-notification-authority.adapter'
import {
  registerIdentityAccountNotificationConsumers,
  registerOrganizationPurgePendingNoticeConsumer,
} from './infrastructure/identity-account-outbox-consumers'
import { createNotificationOrganizationExportContributor } from './infrastructure/adapters/notification-organization-export.adapter'
import { createNotificationOrganizationLifecycleContributor } from './infrastructure/adapters/notification-organization-lifecycle.adapter'

export const NOTIFICATION_DELIVERY_LAG_GRACE_MS = 60_000
export const NOTIFICATION_DELIVERY_LAG_LOOKBACK_MS = 24 * 60 * 60 * 1000
export const NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT =
  MAX_NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  outboxRepo: OutboxRepository
  queue: Queue | undefined
  clock: () => Date
  idGen: () => string
  logger: LoggerPort
  /** Current, eligibility-filtered Property/Portal notification authorities. */
  responsibleManagers: ResponsibleManagerLookupPort
  /** Guest-owned source attribution; Notification never reads Guest tables. */
  feedbackPortalLookup: FeedbackPortalLookupPort
  googleConnectionProperties: GoogleConnectionPropertyLookup
  /** Goal-owned exact closed-and-achieved result lookup. */
  monthlyResultFacts: MonthlyResultNotificationFactsLookup
  /** Portal-owned exact current Health state fence for delayed delivery. */
  portalHealthLookup: PortalHealthLookupPort
}>

export const buildNotificationContext = (input: BuildInput) => {
  const notificationRepo = createNotificationRepository(input.db)
  const gapRepo = createNotificationGapRepository(input.db)
  const deliveryLagRepo = createNotificationDeliveryLagRepository(input.db)
  const emailRepo = createNotificationEmailRepository(input.db)
  const prefRepo = createNotificationPreferenceRepository(input.db)
  const oneClickUnsubscribeRepo = createOneClickUnsubscribeRepository(input.db)
  const handleResendEvent = createResendEventHandler({ emailRepo, logger: input.logger })
  const userLookup = createDbUserLookupAdapter(input.db)
  const inboxItemLookup = createInboxItemLookupAdapter(
    input.db,
    input.feedbackPortalLookup,
  )
  const escalationResolutions = createEscalationResolutionLookupAdapter(input.db)
  const organizationAccountAuthority = createOrganizationAccountNotificationAuthority(
    input.db,
  )
  const authorizeAudience = createNotificationAudienceAuthorizer({
    userLookup,
    responsibleManagers: input.responsibleManagers,
    inboxItemLookup,
    escalationResolutions,
    portalHealthLookup: input.portalHealthLookup,
    monthlyResultFacts: input.monthlyResultFacts,
    organizationAccountAuthority,
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

  // Register event handlers that enqueue BullMQ jobs.
  // BQC-3.6: the queue is wrapped so every insert-notification enqueue
  // inherits the catalogue retry policy (attempts/backoff+jitter/timeout).
  const policyQueue = input.queue ? withCatalogueJobOptions(input.queue) : undefined
  // Immediate EventBus delivery and durable replay deliberately share this
  // wrapper. Whichever path wins the stable BullMQ job identity therefore
  // carries the same Postgres materialization marker.
  const notificationDeliveryQueue = policyQueue
    ? withBetaOutboxNotificationDelivery(policyQueue, input.outboxRepo)
    : undefined
  if (notificationDeliveryQueue) {
    registerNotificationHandlers({
      events: input.events,
      queue: notificationDeliveryQueue,
      userLookup,
      responsibleManagers: input.responsibleManagers,
      inboxItemLookup,
      googleConnectionProperties: input.googleConnectionProperties,
      clock: input.clock,
      logger: input.logger,
    })
    registerPortalNotificationHandlers({
      events: input.events,
      queue: notificationDeliveryQueue,
      userLookup,
      logger: input.logger,
    })
    registerPropertyNotificationHandlers({
      events: input.events,
      queue: notificationDeliveryQueue,
      userLookup,
      logger: input.logger,
    })
  }

  // The one fan-out identity the bus handler, the durable consumer and the
  // reconciliation sweep all share (infrastructure/inbox-notification-fanout).
  const fanoutDeps = notificationDeliveryQueue
    ? {
        queue: notificationDeliveryQueue,
        userLookup,
        responsibleManagers: input.responsibleManagers,
        inboxItemLookup,
        clock: input.clock,
        logger: input.logger,
      }
    : undefined

  /**
   * The window the gauge and the sweep agree on: items old enough to judge
   * (past the grace edge) and recent enough to be worth healing.
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
        await input.queue!.add(
          URGENT_EMAIL_JOB_NAME,
          {
            ...data,
            ...createJobExecutionEnvelope({
              organizationId: data.organizationId,
              ...(data.propertyId === undefined ? {} : { propertyId: data.propertyId }),
              capability: 'notification.send_email',
              initiator: { kind: 'system', id: 'notification:urgent-enqueue' },
              correlationId: `notification-email:${data.notificationEmailId}`,
            }),
          },
          {
            ...jobEnqueueOptions(URGENT_EMAIL_JOB_NAME),
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
      enqueueImmediateEmail,
    }),
  } as const

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
     * Feeds the `notification.missing_for_inbox_item` gauge. Exposed here
     * because `src/shared/observability/health-metrics.ts` cannot import a
     * context — the composition root injects this reader instead.
     */
    readMissingNotificationCount: (): Promise<number> =>
      gapRepo.countItemsMissingNotifications({
        ...gapWindow(),
        scanLimit: NOTIFICATION_GAP_SCAN_LIMIT,
      }),

    /**
     * Payload-free, bounded evidence for durable-source→Redis and
     * Redis→Postgres materialization lag. The one-minute grace is the accepted
     * healthy in-app target; the 24-hour lower bound prevents an operational
     * read from becoming a historical table scan.
     */
    readNotificationDeliveryLag: () => {
      const now = input.clock().getTime()
      return deliveryLagRepo.read({
        recordedAtOrAfter: new Date(now - NOTIFICATION_DELIVERY_LAG_LOOKBACK_MS),
        recordedBefore: new Date(now - NOTIFICATION_DELIVERY_LAG_GRACE_MS),
        scanLimit: NOTIFICATION_DELIVERY_LAG_SCAN_LIMIT,
      })
    },

    // Query methods exposed for server functions
    findById: (id: string, orgId: string) => notificationRepo.findById(id, orgId),
    getFeedHead: (
      userId: string,
      orgId: string,
      limit: number,
      filter: NotificationListFilter,
    ) => notificationRepo.readFeedHead(userId, orgId, limit, filter),
    getNotifications: (
      userId: string,
      orgId: string,
      limit: number,
      offset: number,
      filter: NotificationListFilter,
    ) => notificationRepo.findByUser(userId, orgId, limit, offset, filter),
    markRead: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, markNotificationRead)
      if (now === null) return // invalid transition, skip
      await notificationRepo.markRead(id, userId, orgId, now, now)
    },
    /**
     * Read -> unread for the row menu. Resolves to the flipped notification, or
     * null when the flip is a no-op: either the transition is invalid (the row
     * is already unread or was dismissed) or ADR 0046 r.2's unread-uniqueness
     * key is already held by another row for the same (user, type, resource) —
     * in which case that row IS the user's unread signal and there is nothing
     * to do. A wrong or foreign id still throws `not_found`.
     */
    markUnread: async (id: string, orgId: string, userId: UserId) => {
      const now = await applyOwnedTransition(id, orgId, userId, markNotificationUnread)
      if (now === null) return null // invalid transition, skip
      return notificationRepo.markUnread(id, userId, orgId, now)
    },
    markAllRead: (userId: string, orgId: string) => {
      const now = input.clock()
      return notificationRepo.markAllRead(userId, orgId, now)
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
    getPreferences: (userId: string, orgId: string) => prefRepo.findByUser(userId, orgId),
    getUserSettings: (userId: string, orgId: string) =>
      prefRepo.getUserSettings(userId, orgId),
    updatePreference: (
      userId: string,
      orgId: string,
      propertyId: string,
      category: NotificationCategory,
      channel: NotificationChannel,
      enabled: boolean,
      cadence: NotificationCadence,
      urgentBypassEnabled: boolean,
      quietHoursStart: string | null,
      quietHoursEnd: string | null,
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
          urgentBypassEnabled,
          quietHoursStart,
          quietHoursEnd,
        },
        () => now,
      )
      if (result.isErr()) throw result.error
      return prefRepo.upsert(result.value)
    },
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
      userId: string,
      orgId: string,
      locale: string,
      timezone: string,
    ) => {
      const now = input.clock()
      return prefRepo.upsertUserSettings({
        userId: userId as UserId,
        organizationId: orgId as OrganizationId,
        locale,
        timezone,
        createdAt: now,
        updatedAt: now,
      })
    },
  } as const

  /**
   * Context-owned durable consumer registration. It is inert without the
   * worker queue, so web composition can expose the capability without
   * exposing Notification repositories or use cases.
   */
  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    if (!fanoutDeps) return
    registerIdentityAccountNotificationConsumers(consumerRegistry, {
      queue: fanoutDeps.queue,
      receipts: input.outboxRepo,
    })
    // LIF-01 program bullet 5 — the mandatory final notice at Purge Pending.
    // Registering it does NOT arm the lifecycle: the transition that produces
    // the fact is still driven by a quarantined schedule.
    registerOrganizationPurgePendingNoticeConsumer(consumerRegistry, {
      queue: fanoutDeps.queue,
      userLookup,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerNotificationConsumers(consumerRegistry, {
      ...fanoutDeps,
      receipts: input.outboxRepo,
    })
    registerWorkflowNotificationConsumers(consumerRegistry, {
      ...fanoutDeps,
      receipts: input.outboxRepo,
    })
    registerBulkAssignmentNotificationConsumer(consumerRegistry, {
      queue: fanoutDeps.queue,
      userLookup,
      receipts: input.outboxRepo,
    })
    registerEscalationResolutionNotificationConsumer(consumerRegistry, {
      queue: fanoutDeps.queue,
      escalationResolutions,
      responsibleManagers: input.responsibleManagers,
      receipts: input.outboxRepo,
    })
    registerHandlingCycleNotificationConsumers(consumerRegistry, {
      ...fanoutDeps,
      receipts: input.outboxRepo,
    })
    registerResponseTargetNotificationConsumer(consumerRegistry, {
      ...fanoutDeps,
      receipts: input.outboxRepo,
    })
    registerGoalNotificationConsumer(consumerRegistry, {
      queue: fanoutDeps.queue,
      monthlyResultFacts: input.monthlyResultFacts,
      responsibleManagers: input.responsibleManagers,
      userLookup,
      receipts: input.outboxRepo,
    })
    registerPortalNotificationConsumers(consumerRegistry, {
      queue: fanoutDeps.queue,
      userLookup,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerPortalHealthNotificationConsumer(consumerRegistry, {
      queue: fanoutDeps.queue,
      responsibleManagers: input.responsibleManagers,
      userLookup,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerPropertyNotificationConsumers(consumerRegistry, {
      queue: fanoutDeps.queue,
      userLookup,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    registerIntegrationNotificationConsumers(consumerRegistry, {
      queue: fanoutDeps.queue,
      userLookup,
      googleConnectionProperties: input.googleConnectionProperties,
      logger: input.logger,
      receipts: input.outboxRepo,
    })
    // Executable readiness contract: compare the beta trigger/recipient
    // matrix with the consumers that are actually present in this worker.
    // ARC-03-T7: read the registry this container just registered into — a
    // process-global read would let one container's matrix pass on another
    // container's consumers.
    assertBetaNotificationTriggerMatrix(consumerRegistry.list())
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
        deliverySettlement,
        reconcileMissingNotificationsHandler: fanoutDeps
          ? createReconcileMissingNotificationsHandler({ ...fanoutDeps, gapRepo })
          : undefined,
      },
    }),
  } as const
}
