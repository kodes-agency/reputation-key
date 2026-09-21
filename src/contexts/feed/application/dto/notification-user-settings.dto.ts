import { z } from 'zod/v4'

const localeLanguagePattern = /^[A-Za-z]{2,3}$/
const localeSubtagPattern = /^[A-Za-z0-9]{2,8}$/

function isSupportedNotificationLocale(locale: string): boolean {
  const [language, ...subtags] = locale.split('-')
  return (
    localeLanguagePattern.test(language ?? '') &&
    subtags.every((subtag) => localeSubtagPattern.test(subtag))
  )
}

function isSupportedNotificationTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

/** Each setting's own rule, shared by the form fields and the save. */
const notificationUserSettingsFields = z.object({
  locale: z
    .string()
    .max(35)
    .refine(isSupportedNotificationLocale, 'Enter a valid locale'),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isSupportedNotificationTimezone, 'Enter a valid IANA timezone'),
})

/** The settings form's shape: both fields are always on screen. */
export const notificationFormattingFormDto = notificationUserSettingsFields

/**
 * The authenticated save. It carries only what the user changed: an untouched
 * timezone must never be written over the one delivery already uses
 * (ADR 0046 r.3).
 */
export const notificationUserSettingsDto = notificationUserSettingsFields
  .partial()
  .refine(
    (value) => value.locale !== undefined || value.timezone !== undefined,
    'Change the language or the timezone before saving',
  )

export type NotificationUserSettingsInput = z.infer<typeof notificationUserSettingsDto>
