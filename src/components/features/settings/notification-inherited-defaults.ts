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
    : { enabled: stored.enabled, cadence: stored.cadence }
}

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
  const emailWords = email.enabled ? CADENCE_WORDS[email.cadence] : 'off'
  return `A new property gets in-app ${inApp.enabled ? 'on' : 'off'}, email ${emailWords}.`
}
