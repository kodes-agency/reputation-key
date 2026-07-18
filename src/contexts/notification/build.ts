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
import { createDbUserLookupAdapter } from './infrastructure/adapters/db-user-lookup.adapter'
import { createInboxItemLookupAdapter } from './infrastructure/adapters/inbox-item-lookup.adapter'
import { registerNotificationHandlers } from './infrastructure/event-handlers'
import { insertNotification } from './application/use-cases/insert-notification'
import { URGENT_EMAIL_JOB_NAME } from './infrastructure/jobs/urgent-email.job'
import { jobEnqueueOptions, withCatalogueJobOptions } from '#/shared/jobs/job-policy'
import {
  markNotificationRead,
  dismissNotification,
} from './domain/constructors-transitions'
import { createNotificationPreference } from './domain/constructors-preference'
import { notificationError } from './domain/errors'
import type { NotificationType } from './domain/types'
import type { UserId, OrganizationId } from '#/shared/domain/ids'

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  queue: Queue | undefined
  clock: () => Date
  logger: LoggerPort
}>

export const buildNotificationContext = (input: BuildInput) => {
  const notificationRepo = createNotificationRepository(input.db)
  const emailRepo = createNotificationEmailRepository(input.db)
  const prefRepo = createNotificationPreferenceRepository(input.db)
  const userLookup = createDbUserLookupAdapter(input.db)
  const inboxItemLookup = createInboxItemLookupAdapter(input.db)

  // Register event handlers that enqueue BullMQ jobs.
  // BQC-3.6: the queue is wrapped so every insert-notification enqueue
  // inherits the catalogue retry policy (attempts/backoff+jitter/timeout).
  if (input.queue) {
    registerNotificationHandlers({
      events: input.events,
      queue: withCatalogueJobOptions(input.queue),
      userLookup,
      inboxItemLookup,
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
      enqueueUrgentEmail: input.queue
        ? async (data) => {
            await input.queue!.add(URGENT_EMAIL_JOB_NAME, data, {
              ...jobEnqueueOptions(URGENT_EMAIL_JOB_NAME),
            })
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
    updatePreference: (
      userId: string,
      orgId: string,
      type: NotificationType,
      emailEnabled: boolean,
      inAppEnabled: boolean,
    ) => {
      const now = input.clock()
      const result = createNotificationPreference(
        {
          id: notificationPreferenceId(crypto.randomUUID()),
          userId: userId as UserId,
          organizationId: orgId as OrganizationId,
          type,
          emailEnabled,
          inAppEnabled,
        },
        () => now,
      )
      if (result.isErr()) {
        throw result.error
      }
      return prefRepo.upsert(result.value)
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
