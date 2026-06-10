// Notification context — insert notification use case
// Creates a notification, checks preferences, persists, and enqueues email if needed.

import type { Notification } from '../../domain/types'
import type { NotificationType } from '../../domain/types'
import { createNotification } from '../../domain/constructors'
import { createNotificationEmail } from '../../domain/constructors-email'
import type { NotificationRepositoryPort } from '../ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from '../ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../ports/notification-preference-repository.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  NotificationId,
  NotificationEmailId,
  UserId,
  OrganizationId,
} from '#/shared/domain/ids'

// ── Input ───────────────────────────────────────────────────────────

export type InsertNotificationInput = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  type: NotificationType
  resourceType: 'inbox_item' | 'reply' | 'goal'
  resourceId: string
  eventId: string
  title: string
  body: string | null
}>

// ── Deps ────────────────────────────────────────────────────────────

export type InsertNotificationDeps = Readonly<{
  notificationRepo: NotificationRepositoryPort
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  clock: () => Date
  idGen: () => NotificationId
  emailIdGen: () => NotificationEmailId
  logger: LoggerPort
}>

// ── Use case ────────────────────────────────────────────────────────

export const insertNotification =
  (deps: InsertNotificationDeps) =>
  async (input: InsertNotificationInput): Promise<Notification | null> => {
    const { logger } = deps

    // 1. Construct domain object
    const result = createNotification(input, deps.clock)
    if (result.isErr()) {
      logger.warn({ error: result.error, input }, 'Failed to construct notification')
      throw new Error(result.error.message)
    }

    // 2. Check notification preference
    const pref = await deps.preferenceRepo.findByUserAndType(
      input.userId,
      input.organizationId,
      input.type,
    )

    const inAppEnabled = pref?.inAppEnabled ?? true // default-on
    const emailEnabled = pref?.emailEnabled ?? true

    if (!inAppEnabled) {
      logger.info(
        { userId: input.userId, type: input.type },
        'Notification skipped — in-app disabled by preference',
      )
      return null
    }

    // 3. Assign ID and persist
    const notification: Notification = { ...result.value, id: deps.idGen() }
    const inserted = await deps.notificationRepo.insert(notification)

    // 4. Enqueue email if enabled
    if (emailEnabled) {
      const emailResult = createNotificationEmail(
        {
          notificationId: inserted.id,
          userId: inserted.userId,
          organizationId: inserted.organizationId,
          priority: inserted.priority,
        },
        deps.clock,
      )

      if (emailResult.isOk()) {
        const emailEntry = { ...emailResult.value, id: deps.emailIdGen() }
        await deps.emailRepo.insert(emailEntry)
      } else {
        logger.warn(
          { error: emailResult.error, notificationId: inserted.id },
          'Failed to create email queue entry',
        )
      }
    }

    return inserted
  }

export type InsertNotification = typeof insertNotification
