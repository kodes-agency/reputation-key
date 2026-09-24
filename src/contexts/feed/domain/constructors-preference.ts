// Feed notification surface — preference constructors.
//
// Three things a person configures, and what each one may hold:
//  - a per-(Property, category, channel) preference row: on/off and cadence;
//  - a per-(category, channel) default a Property with no row inherits;
//  - a delivery window (quiet hours + urgent bypass), theirs or a Property's.
//
// Quiet hours and the urgent bypass left the preference row in the
// 2026-09-23 amendment to ADR 0046: they are the person's, not the Property's.

import { ok, err, type Result } from '#/shared/domain'
import type {
  ConfigurableNotificationCategory,
  NotificationCadence,
  NotificationCategory,
  NotificationCategoryDefault,
  NotificationChannel,
  NotificationPreference,
  PersonalDeliveryWindow,
} from './notification-types'
import type {
  NotificationPreferenceId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'
import { notificationError, type NotificationError } from './notification-errors'
import { isPreferenceDisableable } from './notification-policy'
import { offeredEmailCadences } from './notification-cadence'

const CATEGORIES: Readonly<Record<NotificationCategory, true>> = {
  mandatory: true,
  urgent_operational: true,
  workflow_collaboration: true,
  recognition: true,
}
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/**
 * What every configurable row must satisfy, whether it names a Property or
 * stands as the person's default for one. Returns the refusal, or null.
 */
const configurableRowRefusal = (
  input: Readonly<{
    category: NotificationCategory
    channel: NotificationChannel
    enabled: boolean
    cadence: NotificationCadence
  }>,
): NotificationError | null => {
  if (!CATEGORIES[input.category]) {
    return notificationError('invalid_type', 'Invalid notification category')
  }
  if (input.category === 'mandatory') {
    return notificationError(
      'invalid_input',
      'Mandatory notifications cannot be configured',
    )
  }
  if (input.channel !== 'in_app' && input.channel !== 'email') {
    return notificationError('invalid_input', 'Invalid notification channel')
  }
  if (input.cadence !== 'immediate' && input.cadence !== 'daily') {
    return notificationError('invalid_input', 'Invalid notification cadence')
  }
  if (
    input.channel === 'email' &&
    !offeredEmailCadences(input.category).includes(input.cadence)
  ) {
    return notificationError('invalid_input', 'Goal email is sent once a day')
  }
  if (!isPreferenceDisableable(input.category, input.channel) && !input.enabled) {
    return notificationError(
      'invalid_input',
      'This notification channel is required and cannot be disabled',
    )
  }
  return null
}

export type CreateNotificationPreferenceInput = Readonly<{
  id: NotificationPreferenceId
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId
  category: NotificationCategory
  channel: NotificationChannel
  enabled: boolean
  cadence: NotificationCadence
}>

export const createNotificationPreference = (
  input: CreateNotificationPreferenceInput,
  clock: () => Date,
): Result<NotificationPreference, NotificationError> => {
  const refusal = configurableRowRefusal(input)
  if (refusal) return err(refusal)
  const now = clock()
  return ok({ ...input, createdAt: now, updatedAt: now })
}

export type CreateNotificationCategoryDefaultInput = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  category: ConfigurableNotificationCategory
  channel: NotificationChannel
  enabled: boolean
  cadence: NotificationCadence
}>

/**
 * The person's answer for a category across every Property they have — and
 * every Property they are given next, which used to fall through to the
 * versioned defaults with nobody the wiser.
 */
export const createNotificationCategoryDefault = (
  input: CreateNotificationCategoryDefaultInput,
  clock: () => Date,
): Result<NotificationCategoryDefault, NotificationError> => {
  const refusal = configurableRowRefusal(input)
  if (refusal) return err(refusal)
  const now = clock()
  return ok({ ...input, createdAt: now, updatedAt: now })
}

/**
 * A delivery window, the person's own or one Property's override of it.
 *
 * Both times are present or neither is, and equal times are refused: delivery
 * reads those as no quiet hours (`isQuietMinute`), so a saved 22:00-22:00
 * looked like quiet hours on screen and silenced nothing.
 */
export const createPersonalDeliveryWindow = (
  input: PersonalDeliveryWindow,
): Result<PersonalDeliveryWindow, NotificationError> => {
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
  if (input.quietHoursStart !== null && input.quietHoursStart === input.quietHoursEnd) {
    return err(
      notificationError(
        'invalid_input',
        'Quiet hours must start and end at different times',
      ),
    )
  }
  return ok({
    quietHoursStart: input.quietHoursStart,
    quietHoursEnd: input.quietHoursEnd,
    urgentBypassEnabled: input.urgentBypassEnabled,
  })
}
