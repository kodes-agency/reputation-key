// Notification context — composition root
// Per architecture: factory pattern `buildNotificationContext(deps)` returning publicApi + internal.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { notificationId, notificationEmailId } from '#/shared/domain/ids'
import { createNotificationRepository } from './infrastructure/repositories/notification.repository'
import { createNotificationEmailRepository } from './infrastructure/repositories/notification-email.repository'
import { createNotificationPreferenceRepository } from './infrastructure/repositories/notification-preference.repository'
import { createDbUserLookupAdapter } from './infrastructure/adapters/db-user-lookup.adapter'
import { registerNotificationHandlers } from './infrastructure/event-handlers'
import { insertNotification } from './application/use-cases/insert-notification'

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  queue: Queue | undefined
  clock: () => Date
  logger: LoggerPort
}>

export const buildNotificationContext = (input: BuildInput) => {
  const notificationRepo = createNotificationRepository(input.db)
  const emailRepo = createNotificationEmailRepository(input.db)
  const prefRepo = createNotificationPreferenceRepository(input.db)
  const userLookup = createDbUserLookupAdapter(input.db)

  // Register event handlers that enqueue BullMQ jobs
  if (input.queue) {
    registerNotificationHandlers({
      events: input.events,
      queue: input.queue,
      userLookup,
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
    }),
  } as const

  const publicApi = {
    insertNotification: useCases.insertNotification,

    // Query methods exposed for server functions
    getUnreadCount: (userId: string, orgId: string) =>
      notificationRepo.countUnreadByUser(userId, orgId),
    getNotifications: (userId: string, orgId: string, limit: number, offset: number) =>
      notificationRepo.findByUser(userId, orgId, limit, offset),
    markRead: (id: string, orgId: string) =>
      notificationRepo.markRead(id, orgId, input.clock()),
    markAllRead: (userId: string, orgId: string) =>
      notificationRepo.markAllRead(userId, orgId),
  } as const

  return {
    publicApi,
    internal: {
      repos: { notificationRepo, emailRepo, prefRepo },
      useCases,
    },
  } as const
}
