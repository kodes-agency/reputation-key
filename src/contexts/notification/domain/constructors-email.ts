// Notification context — email queue entry constructor

import { err, ok, type Result } from '#/shared/domain'
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
import { notificationError, type NotificationError } from './errors'

export type CreateNotificationEmailInput = Readonly<{
  id: NotificationEmailId
  notificationId: NotificationId
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId | null
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
  if (input.category === 'mandatory' && input.propertyId !== null) {
    return err(
      notificationError('invalid_input', 'Mandatory email must use Organization scope'),
    )
  }
  if (input.category !== 'mandatory' && !input.propertyId) {
    return err(
      notificationError('invalid_input', 'Property-scoped email requires propertyId'),
    )
  }
  if (input.category === 'mandatory' && input.cadence !== 'immediate') {
    return err(notificationError('invalid_input', 'Mandatory email must be immediate'))
  }
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
