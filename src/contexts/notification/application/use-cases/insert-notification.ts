// Notification context — insert notification use case
// Creates a notification, checks preferences, persists, and enqueues email if needed.

import type { Notification } from '../../domain/types'
import {
  createNotification,
  type CreateNotificationInput,
} from '../../domain/constructors'
import { createNotificationEmail } from '../../domain/constructors-email'
import type { NotificationRepositoryPort } from '../ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from '../ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../ports/notification-preference-repository.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { NotificationId, NotificationEmailId } from '#/shared/domain/ids'

// ── Input ───────────────────────────────────────────────────────────

export type InsertNotificationInput = CreateNotificationInput

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

    if (!inAppEnabled && !emailEnabled) {
      logger.info(
        { userId: input.userId, type: input.type },
        'Notification skipped — both in-app and email disabled by preference',
      )
      return null
    }

    // 3. Assign ID and persist — always create the row if any channel is enabled
    // (email needs the FK reference to the notification row)
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

    // 5. Return notification only if in-app channel is enabled
    if (!inAppEnabled) {
      logger.info(
        { notificationId: inserted.id },
        'Notification persisted for email only — not returned for in-app display',
      )
      return null
    }

    return inserted
  }

export type InsertNotification = typeof insertNotification
