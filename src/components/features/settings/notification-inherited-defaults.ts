// What a property with no preference row of its own gets, in words.
//
// Before ADR 0046's 2026-09-23 amendment a property added or reassigned after
// the person configured everything else silently fell through to the versioned
// defaults — urgent email, immediately, whatever they had chosen everywhere
// else. It is now the person's own default, and this says what it is so the
// button that sets it is not a leap of faith.

import {
  resolveCategoryPreference,
  type ConfigurableNotificationCategory,
  type NotificationCategoryDefault,
  type NotificationChannel,
} from '#/contexts/feed/application/public-api'

const CADENCE_WORDS = {
  immediate: 'immediately',
  daily: 'daily at 08:00',
} as const

const defaultFor = (
  defaults: readonly NotificationCategoryDefault[],
  category: ConfigurableNotificationCategory,
  channel: NotificationChannel,
) => {
  const stored = defaults.find(
    (row) => row.category === category && row.channel === channel,
  )
  return stored === undefined
    ? null
    : { enabled: stored.enabled, cadence: stored.cadence, maxRating: stored.maxRating }
}

/** "N★ or lower", said so it reads in a sentence. */
export const lowRatingWords = (maxRating: number): string =>
  maxRating === 1 ? '1★ only' : `${maxRating}★ or lower`

export function describeInheritedDefault(
  category: ConfigurableNotificationCategory,
  defaults: readonly NotificationCategoryDefault[],
): string {
  const resolve = (channel: NotificationChannel) =>
    resolveCategoryPreference({
      category,
      channel,
      property: null,
      personalDefault: defaultFor(defaults, category, channel),
    })
  const inApp = resolve('in_app')
  const email = resolve('email')
  if (category === 'low_ratings') {
    const words = (values: typeof inApp) =>
      values.enabled && values.maxRating ? lowRatingWords(values.maxRating) : 'off'
    const when = email.enabled ? `, ${CADENCE_WORDS[email.cadence]}` : ''
    return `A new property gets ${words(inApp)} in the app, ${words(email)} by email${when}.`
  }
  const emailWords = email.enabled ? CADENCE_WORDS[email.cadence] : 'off'
  return `A new property gets in-app ${inApp.enabled ? 'on' : 'off'}, email ${emailWords}.`
}
