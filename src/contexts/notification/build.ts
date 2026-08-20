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
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
} from './domain/types'
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
  const emailRepo = createNotificationEmailRepository(input.db)
  const prefRepo = createNotificationPreferenceRepository(input.db)
  const userLookup = createDbUserLookupAdapter(input.db, input.propertyAccessHolders)
  const inboxItemLookup = createInboxItemLookupAdapter(input.db)
  const recognitionLookup = createRecognitionLookupAdapter(input.db)

  // Register event handlers that enqueue BullMQ jobs.
  // BQC-3.6: the queue is wrapped so every insert-notification enqueue
  // inherits the catalogue retry policy (attempts/backoff+jitter/timeout).
  if (input.queue) {
    registerNotificationHandlers({
      events: input.events,
      queue: withCatalogueJobOptions(input.queue),
      userLookup,
      inboxItemLookup,
      recognitionLookup,
      clock: input.clock,
      logger: input.logger,
    })
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

    // Query methods exposed for server functions
    findById: (id: string, orgId: string) => notificationRepo.findById(id, orgId),
    getUnreadCount: (userId: string, orgId: string) =>
      notificationRepo.countUnreadByUser(userId, orgId),
    getNotifications: (userId: string, orgId: string, limit: number, offset: number) =>
      notificationRepo.findByUser(userId, orgId, limit, offset),
    markRead: async (id: string, orgId: string, userId: UserId) => {
      const n = await notificationRepo.findById(id, orgId)
      if (!n || n.userId !== userId) {
        throw notificationError('not_found', 'Notification not found or access denied')
      }
      const now = input.clock()
      const result = markNotificationRead(n, () => now)
      if (result.isErr()) return // invalid transition, skip
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
      const n = await notificationRepo.findById(id, orgId)
      if (!n || n.userId !== userId) {
        throw notificationError('not_found', 'Notification not found or access denied')
      }
      const now = input.clock()
      const result = markNotificationUnread(n, () => now)
      if (result.isErr()) return null // invalid transition, skip
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
      const n = await notificationRepo.findById(id, orgId)
      if (!n || n.userId !== userId) {
        throw notificationError('not_found', 'Notification not found or access denied')
      }
      const now = input.clock()
      const result = dismissNotification(n, () => now)
      if (result.isErr()) return // invalid transition, skip
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
      repos: { notificationRepo, emailRepo, prefRepo },
      useCases,
    },
  } as const
}
