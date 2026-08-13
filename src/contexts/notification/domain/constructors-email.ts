// Notification context — email queue entry constructor

import { ok, type Result } from '#/shared/domain'
import type {
  NotificationCadence,
  NotificationCategory,
  NotificationEmail,
  NotificationPriority,
} from './types'
import type {
  NotificationEmailId,
  NotificationId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'
import type { NotificationError } from './errors'

export type CreateNotificationEmailInput = Readonly<{
  id: NotificationEmailId
  notificationId: NotificationId
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId
  category: NotificationCategory
  cadence: NotificationCadence
  priority: NotificationPriority
  idempotencyKey: string
  notBefore: Date | null
}>

export const createNotificationEmail = (
  input: CreateNotificationEmailInput,
  clock: () => Date,
): Result<NotificationEmail, NotificationError> => {
  const now = clock()
  return ok({
    ...input,
    status: 'pending',
    providerMessageId: null,
    providerState: null,
    lastErrorClass: null,
    suppressionReason: null,
    nextAttemptAt: null,
    attemptedAt: null,
    acceptedAt: null,
    deliveredAt: null,
    bouncedAt: null,
    sentAt: null,
    failedAt: null,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  })
}
