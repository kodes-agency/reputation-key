// Notification context — preference constructor

import { ok, err, type Result } from '#/shared/domain'
import type { NotificationPreference, NotificationType } from './types'
import type {
  NotificationPreferenceId,
  UserId,
  OrganizationId,
} from '#/shared/domain/ids'
import { notificationError, type NotificationError } from './errors'
import { ALLOWED_TYPES } from './constructors'

// ── Create/update preference ────────────────────────────────────────

export type CreateNotificationPreferenceInput = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  type: NotificationType
  emailEnabled: boolean
  inAppEnabled: boolean
}>

export const createNotificationPreference = (
  input: CreateNotificationPreferenceInput,
  clock: () => Date,
): Result<NotificationPreference, NotificationError> => {
  if (!ALLOWED_TYPES.has(input.type)) {
    return err(
      notificationError('invalid_type', `Invalid notification type: ${input.type}`, {
        type: input.type,
      }),
    )
  }

  const now = clock()
  return ok({
    id: '' as unknown as NotificationPreferenceId,
    userId: input.userId,
    organizationId: input.organizationId,
    type: input.type,
    emailEnabled: input.emailEnabled,
    inAppEnabled: input.inAppEnabled,
    createdAt: now,
    updatedAt: now,
  })
}
