// Notification context — insert notification use case
// Creates a notification, checks preferences, persists, and enqueues email if needed.

import {
  createNotification,
  type CreateNotificationInput,
} from '../../domain/constructors'
import { createNotificationEmail } from '../../domain/constructors-email'
import type { NotificationRepositoryPort } from '../ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from '../ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../ports/notification-preference-repository.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  unbrand,
  type NotificationId,
  type NotificationEmailId,
} from '#/shared/domain/ids'
import type { Notification as DomainNotification } from '../../domain/types'

// ── Input ───────────────────────────────────────────────────────────

export type InsertNotificationInput = Omit<CreateNotificationInput, 'id'>

// ── Deps ────────────────────────────────────────────────────────────

export type InsertNotificationDeps = Readonly<{
  notificationRepo: NotificationRepositoryPort
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  clock: () => Date
  idGen: () => NotificationId
  emailIdGen: () => NotificationEmailId
  logger: LoggerPort
  enqueueUrgentEmail?: (data: {
    notificationEmailId: string
    organizationId: string
  }) => Promise<void>
}>

// ── Channel-preference resolution ───────────────────────────────────
// Reads the sparse preference row; both channels default to enabled.

type ChannelPreferences = Readonly<{ inAppEnabled: boolean; emailEnabled: boolean }>

const resolveChannelPreferences = async (
  deps: InsertNotificationDeps,
  input: InsertNotificationInput,
): Promise<ChannelPreferences> => {
  const pref = await deps.preferenceRepo.findByUserAndType(
    input.userId,
    input.organizationId,
    input.type,
  )
  return {
    inAppEnabled: pref?.inAppEnabled ?? true, // default-on
    emailEnabled: pref?.emailEnabled ?? true,
  }
}

// ── Email-queue enqueue ─────────────────────────────────────────────

// Best-effort urgent enqueue — if Redis is down the email stays 'pending'
// and is recovered by the digest job's orphaned-urgent sweep.
const enqueueUrgentEmailBestEffort = async (
  deps: InsertNotificationDeps,
  notification: DomainNotification,
  emailId: NotificationEmailId,
): Promise<void> => {
  if (!deps.enqueueUrgentEmail) return
  try {
    await deps.enqueueUrgentEmail({
      notificationEmailId: unbrand(emailId),
      organizationId: unbrand(notification.organizationId),
    })
  } catch (enqueueErr) {
    deps.logger.error(
      { err: enqueueErr, notificationId: notification.id },
      'Failed to enqueue urgent email — will be picked up by digest fallback',
    )
  }
}

// Create + persist the email-queue row. Urgent rows trigger an immediate
// delivery job; normal rows are left 'pending' for the daily digest.
const enqueueEmailEntry = async (
  deps: InsertNotificationDeps,
  notification: DomainNotification,
): Promise<void> => {
  const emailResult = createNotificationEmail(
    {
      id: deps.emailIdGen(),
      notificationId: notification.id,
      userId: notification.userId,
      organizationId: notification.organizationId,
      priority: notification.priority,
    },
    deps.clock,
  )

  if (emailResult.isErr()) {
    deps.logger.warn(
      { error: emailResult.error, notificationId: notification.id },
      'Failed to create email queue entry',
    )
    return
  }

  await deps.emailRepo.insert(emailResult.value)

  // Urgent emails are sent immediately via a dedicated job;
  // normal emails are batched in the daily digest.
  if (notification.priority === 'urgent') {
    await enqueueUrgentEmailBestEffort(deps, notification, emailResult.value.id)
  }
}

// ── Use case ────────────────────────────────────────────────────────

export const insertNotification =
  (deps: InsertNotificationDeps) =>
  async (input: InsertNotificationInput): Promise<DomainNotification | null> => {
    const { logger } = deps

    // 1. Construct + validate the domain entity
    const result = createNotification({ ...input, id: deps.idGen() }, deps.clock)
    if (result.isErr()) {
      logger.warn({ error: result.error, input }, 'Failed to construct notification')
      throw result.error
    }

    // 2. Resolve per-channel preferences
    const { inAppEnabled, emailEnabled } = await resolveChannelPreferences(deps, input)

    if (!inAppEnabled && !emailEnabled) {
      logger.info(
        { userId: input.userId, type: input.type },
        'Notification skipped — both in-app and email disabled by preference',
      )
      return null
    }

    // 3. Persist the notification row (in-app anchor + email FK)
    const inserted = await deps.notificationRepo.insert(result.value)

    // 4. Enqueue the email-queue entry when the email channel is on
    if (emailEnabled) {
      await enqueueEmailEntry(deps, inserted)
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
