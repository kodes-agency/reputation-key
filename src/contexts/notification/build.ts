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
import {
  createDbUserLookupAdapter,
  type PropertyAccessHolderLookup,
} from './infrastructure/adapters/db-user-lookup.adapter'
import { createInboxItemLookupAdapter } from './infrastructure/adapters/inbox-item-lookup.adapter'
import { createRecognitionLookupAdapter } from './infrastructure/adapters/recognition-lookup.adapter'
import { registerNotificationHandlers } from './infrastructure/event-handlers'
import { registerNotificationConsumers } from './infrastructure/outbox-consumers'
import { createNotificationGapRepository } from './infrastructure/repositories/notification-gap.repository'
import {
  createReconcileMissingNotificationsHandler,
  DEFAULT_RECONCILE_GRACE_MS,
  DEFAULT_RECONCILE_LOOKBACK_MS,
  NOTIFICATION_GAP_SCAN_LIMIT,
} from './infrastructure/jobs/reconcile-missing-notifications.job'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { insertNotification } from './application/use-cases/insert-notification'
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

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  queue: Queue | undefined
  clock: () => Date
  logger: LoggerPort
  /**
   * Identity-owned lookup for users holding active access to a property.
   * `property_access_grant` is authoritative for property-scoped recipients, so
   * this is required: without it every property-scoped notification is dropped.
   */
  propertyAccessHolders: PropertyAccessHolderLookup
}>

export const buildNotificationContext = (input: BuildInput) => {
  const notificationRepo = createNotificationRepository(input.db)
  const gapRepo = createNotificationGapRepository(input.db)
  const emailRepo = createNotificationEmailRepository(input.db)
  const prefRepo = createNotificationPreferenceRepository(input.db)
  const userLookup = createDbUserLookupAdapter(input.db, input.propertyAccessHolders)
  const inboxItemLookup = createInboxItemLookupAdapter(input.db)
  const recognitionLookup = createRecognitionLookupAdapter(input.db)

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
  if (policyQueue) {
    registerNotificationHandlers({
      events: input.events,
      queue: policyQueue,
      userLookup,
      inboxItemLookup,
      recognitionLookup,
      clock: input.clock,
      logger: input.logger,
    })
  }

  // The one fan-out identity the bus handler, the durable consumer and the
  // reconciliation sweep all share (infrastructure/inbox-notification-fanout).
  const fanoutDeps = policyQueue
    ? {
        queue: policyQueue,
        userLookup,
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

  const useCases = {
    insertNotification: insertNotification({
      notificationRepo,
      emailRepo,
      preferenceRepo: prefRepo,
      clock: input.clock,
      idGen: () => notificationId(crypto.randomUUID()),
      emailIdGen: () => notificationEmailId(crypto.randomUUID()),
      logger: input.logger,
      enqueueImmediateEmail: input.queue
        ? async (data) => {
            await input.queue!.add(
              URGENT_EMAIL_JOB_NAME,
              {
                ...data,
                ...createJobExecutionEnvelope({
                  organizationId: data.organizationId,
                  propertyId: data.propertyId,
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
        : undefined,
    }),
  } as const

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

    // Query methods exposed for server functions
    findById: (id: string, orgId: string) => notificationRepo.findById(id, orgId),
    getUnreadCount: (userId: string, orgId: string) =>
      notificationRepo.countUnreadByUser(userId, orgId),
    getNotifications: (userId: string, orgId: string, limit: number, offset: number) =>
      notificationRepo.findByUser(userId, orgId, limit, offset),
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
          id: notificationPreferenceId(crypto.randomUUID()),
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

  return {
    publicApi,
    internal: {
      repos: { notificationRepo, emailRepo, prefRepo, gapRepo },
      useCases,
      /**
       * Durable at-least-once path for `inbox.inbox_item.created`. Inert until
       * OUTBOX_DISPATCHER_ENABLED is true (the DURABLE_CUTOVER_INBOX* flags do
       * not apply — they govern the four review.* families); registered
       * regardless so the flip is a config change, not a code change. Without
       * a queue there is nothing to enqueue onto, so registration is skipped
       * rather than registering a consumer that would fail every event.
       */
      registerOutboxConsumers: () => {
        if (!fanoutDeps) return
        registerNotificationConsumers({
          ...fanoutDeps,
          receipts: createOutboxRepository(input.db),
        })
      },
      /**
       * The sweep that heals what the best-effort bus path drops. Undefined
       * without a queue, for the same reason as the consumers above.
       */
      reconcileMissingNotificationsHandler: fanoutDeps
        ? createReconcileMissingNotificationsHandler({ ...fanoutDeps, gapRepo })
        : undefined,
    },
  } as const
}
