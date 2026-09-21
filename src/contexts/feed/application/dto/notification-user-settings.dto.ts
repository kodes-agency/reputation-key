import { z } from 'zod/v4'
import { isValidIanaTimezone } from '#/shared/domain/timezones'

/**
 * The date and time formats the settings page offers: the product's two
 * languages, with English in both its US and UK conventions. `en` is the
 * column default and formats exactly like `en-US`.
 */
export const NOTIFICATION_LOCALES = ['en', 'en-GB', 'bg'] as const

export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number]

/**
 * The authenticated save, shared with the settings form. It carries only what
 * the user changed: an untouched timezone must never be written over the one
 * delivery already uses (ADR 0046 r.3).
 *
 * Both values come from pickers, so both are checked against exactly what the
 * pickers offer. "Intl can resolve it" was the old rule, and it let in fixed
 * offsets (`+03:00`, `Etc/GMT-3`) that ignore daylight saving and put quiet
 * hours and the 08:00 digest an hour off for half the year. A stored legacy
 * value is still honoured when delivery reads it; it just cannot be saved again.
 */
export const notificationUserSettingsDto = z
  .object({
    locale: z
      .enum(NOTIFICATION_LOCALES, { error: 'Choose one of the listed formats' })
      .optional(),
    timezone: z
      .string()
      .refine(isValidIanaTimezone, 'Choose a timezone from the list')
      .optional(),
  })
  .refine(
    (value) => value.locale !== undefined || value.timezone !== undefined,
    'Change the date format or the timezone before saving',
  )

export type NotificationUserSettingsInput = z.infer<typeof notificationUserSettingsDto>
