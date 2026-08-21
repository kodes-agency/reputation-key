// Notification context — preference constructor

import { ok, err, type Result } from '#/shared/domain'
import type {
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
  NotificationPreference,
} from './types'
import type {
  NotificationPreferenceId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'
import { notificationError, type NotificationError } from './errors'
import { isDisableable } from './notification-policy'

const CATEGORIES: Readonly<Record<NotificationCategory, true>> = {
  mandatory: true,
  urgent_operational: true,
  workflow_collaboration: true,
  recognition: true,
}
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export type CreateNotificationPreferenceInput = Readonly<{
  id: NotificationPreferenceId
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId
  category: NotificationCategory
  channel: NotificationChannel
  enabled: boolean
  cadence: NotificationCadence
  urgentBypassEnabled: boolean
  quietHoursStart: string | null
  quietHoursEnd: string | null
}>

export const createNotificationPreference = (
  input: CreateNotificationPreferenceInput,
  clock: () => Date,
): Result<NotificationPreference, NotificationError> => {
  if (!CATEGORIES[input.category]) {
    return err(notificationError('invalid_type', 'Invalid notification category'))
  }
  if (input.channel !== 'in_app' && input.channel !== 'email') {
    return err(notificationError('invalid_input', 'Invalid notification channel'))
  }
  if (input.cadence !== 'immediate' && input.cadence !== 'daily') {
    return err(notificationError('invalid_input', 'Invalid notification cadence'))
  }
  const hasStart = input.quietHoursStart !== null
  const hasEnd = input.quietHoursEnd !== null
  if (
    hasStart !== hasEnd ||
    (input.quietHoursStart !== null && !TIME.test(input.quietHoursStart)) ||
    (input.quietHoursEnd !== null && !TIME.test(input.quietHoursEnd))
  ) {
    return err(
      notificationError('invalid_input', 'Quiet hours require a valid start and end'),
    )
  }
  if (!isDisableable(input.category) && !input.enabled) {
    return err(
      notificationError('invalid_input', 'Mandatory notifications cannot be disabled'),
    )
  }
  if (input.channel !== 'email' && input.urgentBypassEnabled) {
    return err(notificationError('invalid_input', 'Urgent bypass applies only to email'))
  }

  const now = clock()
  return ok({ ...input, createdAt: now, updatedAt: now })
}
