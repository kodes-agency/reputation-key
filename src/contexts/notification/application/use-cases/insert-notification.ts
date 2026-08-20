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
import type {
  Notification as DomainNotification,
  NotificationCadence,
} from '../../domain/types'
import { classifyNotification } from '../../domain/notification-delivery-policy'
import { applyCoalescence, getDefaultEnabled } from '../../domain/notification-policy'
import { isUrgent } from '../../domain/types'

// ── Input ───────────────────────────────────────────────────────────

/**
 * What an event handler enqueues. Handlers pass FACTS in `payload`, never a
 * title or a body: copy is rendered from (type, payload) inside
 * `createNotification` so every channel and every already-stored row agree
 * (ADR 0046 r.8).
 */
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
  enqueueImmediateEmail?: (data: {
    notificationEmailId: string
    organizationId: string
    propertyId: string
  }) => Promise<void>
}>

type ChannelPreferences = Readonly<{
  inAppEnabled: boolean
  emailEnabled: boolean
  emailCadence: NotificationCadence
}>

const resolveChannelPreferences = async (
  deps: InsertNotificationDeps,
  input: InsertNotificationInput,
): Promise<ChannelPreferences> => {
  const category = classifyNotification(input.type)
  const inApp = await deps.preferenceRepo.findForDelivery(
    input.userId,
    input.organizationId,
    input.propertyId,
    category,
    'in_app',
  )
  const email = await deps.preferenceRepo.findForDelivery(
    input.userId,
    input.organizationId,
    input.propertyId,
    category,
    'email',
  )
  return {
    inAppEnabled: inApp?.enabled ?? getDefaultEnabled(category, 'in_app'),
    emailEnabled: email?.enabled ?? getDefaultEnabled(category, 'email'),
    emailCadence: email?.cadence ?? (isUrgent(input.type) ? 'immediate' : 'daily'),
  }
}

// ── Email-queue enqueue ─────────────────────────────────────────────

const enqueueImmediateEmailBestEffort = async (
  deps: InsertNotificationDeps,
  notification: DomainNotification,
  emailId: NotificationEmailId,
): Promise<void> => {
  if (!deps.enqueueImmediateEmail) return
  try {
    await deps.enqueueImmediateEmail({
      notificationEmailId: unbrand(emailId),
      organizationId: unbrand(notification.organizationId),
      propertyId: unbrand(notification.propertyId),
    })
  } catch (enqueueErr) {
    // `correlationId` is the same opaque string the urgent-email job envelope
    // carries, so this failure and the digest sweep's later re-enqueue join on
    // one field. No tenant/entity ids (BQC-7.3, see below). Recovery "depends
    // on" the sweep rather than being guaranteed by it: the sweep is a no-op
    // when outbound email is dark, when no queue is configured, and for
    // non-active properties.
    deps.logger.error(
      {
        err: enqueueErr,
        correlationId: `notification-email:${unbrand(emailId)}`,
        cadence: 'immediate',
      },
      'Immediate notification email enqueue failed — recovery depends on the digest sweep',
    )
  }
}

// Create + persist the email-queue row. Urgent rows trigger an immediate
// delivery job; normal rows are left 'pending' for the daily digest.
const enqueueEmailEntry = async (
  deps: InsertNotificationDeps,
  notification: DomainNotification,
  cadence: NotificationCadence,
): Promise<void> => {
  const emailResult = createNotificationEmail(
    {
      id: deps.emailIdGen(),
      notificationId: notification.id,
      userId: notification.userId,
      organizationId: notification.organizationId,
      propertyId: notification.propertyId,
      category: notification.category,
      cadence,
      priority: notification.priority,
      idempotencyKey: `${unbrand(notification.id)}:email`,
      notBefore: null,
    },
    deps.clock,
  )
  if (emailResult.isErr()) {
    deps.logger.warn({ error: emailResult.error }, 'Failed to create email queue entry')
    return
  }

  const queued = await deps.emailRepo.insert(emailResult.value)
  if (cadence === 'immediate') {
    await enqueueImmediateEmailBestEffort(deps, notification, queued.id)
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
      // BQC-7.3: the raw input (tenant/entity ids) is never logged.
      logger.warn({ error: result.error }, 'Failed to construct notification')
      throw result.error
    }

    const { inAppEnabled, emailEnabled, emailCadence } = await resolveChannelPreferences(
      deps,
      input,
    )

    if (!inAppEnabled && !emailEnabled) {
      logger.info(
        { type: input.type },
        'Notification skipped — both in-app and email disabled by preference',
      )
      return null
    }

    // 2b. ADR 0046 r.2: at most one UNREAD row per (user, type, resource). A
    // repeat event ABSORBS into that row — count bumped, latest arrival
    // stamped, payload merged newest-wins, copy re-rendered from the merged
    // facts (so the row can now read "…Updated 3 times", and a re-escalation
    // that has waited longer says so). No second email: the original queue
    // entry still stands for the same resource. In-app only — an email-only
    // recipient has no unread row to absorb into.
    if (inAppEnabled) {
      const existing = await deps.notificationRepo.findUnreadByUserTypeResource(
        input.userId,
        input.organizationId,
        input.propertyId,
        input.type,
        input.resourceId,
      )
      if (existing) {
        const coalesced = applyCoalescence(
          existing,
          result.value.payload,
          deps.clock(),
        )
        await deps.notificationRepo.refreshUnread(coalesced)
        return coalesced
      }
    }

    // 3. Persist the notification row (in-app anchor + email FK)
    const inserted = await deps.notificationRepo.insert(result.value)

    // 4. Enqueue the email-queue entry when the email channel is on
    if (emailEnabled) {
      await enqueueEmailEntry(deps, inserted, emailCadence)
    }

    // 5. Return notification only if in-app channel is enabled
    if (!inAppEnabled) {
      logger.info(
        'Notification persisted for email only — not returned for in-app display',
      )
      return null
    }

    return inserted
  }

export type InsertNotification = typeof insertNotification
