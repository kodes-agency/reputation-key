import { z } from 'zod/v4'
import { isRegionTimezone } from '#/shared/domain/timezones'

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
 * Both values come from pickers, so both are checked against what the pickers
 * offer. "Intl can resolve it" was the old rule, and it let in fixed offsets
 * (`+03:00`, `Etc/GMT-3`) that ignore daylight saving and put quiet hours and
 * the 08:00 digest an hour off for half the year. The timezone check is by
 * region, not by this runtime's own list: the browser's picker and the server
 * spell some zones differently (`Europe/Kyiv`, `Europe/Kiev`), and a pick must
 * pass both. A stored legacy value is still honoured when delivery reads it;
 * it just cannot be saved again.
 */
export const notificationUserSettingsDto = z
  .object({
    locale: z
      .enum(NOTIFICATION_LOCALES, { error: 'Choose one of the listed formats' })
      .optional(),
    timezone: z
      .string()
      .refine(isRegionTimezone, 'Choose a timezone from the list')
      .optional(),
  })
  .refine(
    (value) => value.locale !== undefined || value.timezone !== undefined,
    'Change the date format or the timezone before saving',
  )

export type NotificationUserSettingsInput = z.infer<typeof notificationUserSettingsDto>

/** The settings form's values: both pickers are always on screen. */
export type NotificationFormattingValues = Readonly<{ locale: string; timezone: string }>

/**
 * Only what the user changed. The pickers start on the values delivery already
 * uses, so sending an untouched timezone back would pin the Organization's
 * zone as the user's own choice, and an untouched legacy value the pickers no
 * longer offer would be refused.
 */
export function changedNotificationFormatting(
  inEffect: NotificationFormattingValues,
  value: NotificationFormattingValues,
): Partial<NotificationFormattingValues> {
  return {
    ...(value.locale === inEffect.locale ? {} : { locale: value.locale }),
    ...(value.timezone === inEffect.timezone ? {} : { timezone: value.timezone }),
  }
}

/**
 * The settings form's submit-time schema, relative to the values in effect:
 * it keeps the fields the user changed and checks them with the save's own
 * rules, reporting a refusal on the field it concerns.
 */
export const notificationFormattingFormDto = (inEffect: NotificationFormattingValues) =>
  z
    .object({ locale: z.string(), timezone: z.string() })
    .transform((value) => changedNotificationFormatting(inEffect, value))
    .pipe(notificationUserSettingsDto)
