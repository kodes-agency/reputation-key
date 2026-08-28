import { z } from 'zod/v4'

const localeLanguagePattern = /^[A-Za-z]{2,3}$/
const localeSubtagPattern = /^[A-Za-z0-9]{2,8}$/

export function isSupportedNotificationLocale(locale: string): boolean {
  const [language, ...subtags] = locale.split('-')
  return (
    localeLanguagePattern.test(language ?? '') &&
    subtags.every((subtag) => localeSubtagPattern.test(subtag))
  )
}

export function isSupportedNotificationTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

/** Shared by the settings form and its authenticated server boundary. */
export const notificationUserSettingsDto = z.object({
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

export type NotificationUserSettingsInput = z.infer<typeof notificationUserSettingsDto>
