import { z } from 'zod/v4'
import { isRegionTimezone } from '#/shared/domain/timezones'

/**
 * The date and time formats the settings page offers. Every word in the
 * product is English (docs/BETA.md), so this control chooses a convention, not
 * a language: it used to offer Bulgarian, which translated nothing and only
 * moved the day in front of the month. `en` is the column default and formats
 * exactly like `en-US`. A row storing a locale no longer offered is still
 * honoured when a timestamp is formatted; it just cannot be saved again.
 */
export const NOTIFICATION_LOCALES = ['en', 'en-GB'] as const

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

// The Property preference endpoints' request shapes. They live here, not in the
// server-function module: a plain export from that module survives the RPC
// transform and ships in the client's initial bundle.

const quietTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  .nullable()

/** Configurable Property categories; Organization mandatory policy is refused. */
export const notificationPreferenceCategory = z.enum([
  'urgent_operational',
  'low_ratings',
  'arrivals',
  'workflow_collaboration',
  'recognition',
  'portal_goals',
  'guest_voice',
])

const notificationChannel = z.enum(['in_app', 'email'])

/**
 * One (Property, category, channel) row: whether it is delivered, and how
 * often. Quiet hours and the urgent bypass are no longer here — they are the
 * person's, saved through `notificationQuietHoursDto` (ADR 0046, amended
 * 2026-09-23).
 *
 * `applyToAllProperties` makes the same answer the person's default for every
 * Property they have and every Property they are given next.
 */
export const updateNotificationPreferenceDto = z
  .object({
    propertyId: z.uuid(),
    category: notificationPreferenceCategory,
    channel: notificationChannel,
    enabled: z.boolean(),
    cadence: z.enum(['immediate', 'daily']),
    /**
     * Low ratings only, and required there: the highest rating this channel
     * is on for ("N★ or lower"). Refused for every other category.
     */
    maxRating: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .optional(),
    applyToAllProperties: z.boolean().optional(),
  })
  .refine(
    (value) => (value.category === 'low_ratings') === (value.maxRating !== undefined),
    'Choose how low a rating to be told about, for Low ratings only',
  )

/**
 * The person's quiet hours and urgent bypass, or one Property's override of
 * them. `propertyId` names the Property being overridden; omitted, this is the
 * person's own window for every Property that does not override it.
 *
 * `follow: true` removes a Property's override so it follows the person again;
 * it is refused without a `propertyId`, because a person always has a window
 * of their own even when it holds nothing back.
 */
export const notificationQuietHoursDto = z
  .object({
    propertyId: z.uuid().optional(),
    follow: z.boolean().optional(),
    quietHoursStart: quietTime.optional(),
    quietHoursEnd: quietTime.optional(),
    urgentBypassEnabled: z.boolean().optional(),
  })
  .refine(
    (value) => value.follow !== true || value.propertyId !== undefined,
    'Only a property can follow your quiet hours',
  )
  // Delivery reads equal times as no quiet hours at all.
  .refine(
    (value) =>
      value.quietHoursStart == null || value.quietHoursStart !== value.quietHoursEnd,
    'Quiet hours must start and end at different times',
  )
  .refine(
    (value) =>
      value.follow === true ||
      (value.quietHoursStart === null) === (value.quietHoursEnd === null),
    'Quiet hours need both a start and an end',
  )

export type NotificationQuietHoursInput = z.infer<typeof notificationQuietHoursDto>
