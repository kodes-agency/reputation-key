// Low ratings: how low a review or rated private feedback must be for each
// channel to tell the person (ADR 0046, amended 2026-09-30). In place of the
// on/off switch every other category has, each channel offers "Off" or a
// star threshold, 1★ to 4★; 3★ or lower in the app and 2★ or lower by email
// until the person chooses. It is the shared rating-threshold field, as the Portal's
// private note and the Organization's low-rating target are.

import { RatingThresholdField } from '#/components/forms/rating-threshold-field'
import {
  getDefaultEnabled,
  getDefaultMaxRating,
  LOW_RATING_THRESHOLDS,
  type LowRatingThreshold,
} from '#/contexts/feed/application/public-api'
import type { NotificationPreferencePatch } from './notifications-settings-view'
import type { PreferenceValues } from './notification-preference-saves'
import { named } from './notification-default-controls'

const CHANNEL_LABELS = { in_app: 'In the app', email: 'By email' } as const

type Channel = keyof typeof CHANNEL_LABELS

/** What the select shows: the threshold, or `null` for Off. */
const valueOf = (
  values: PreferenceValues | undefined,
  channel: Channel,
): LowRatingThreshold | null => {
  const enabled = values?.enabled ?? getDefaultEnabled('low_ratings', channel)
  if (!enabled) return null
  return values?.maxRating ?? getDefaultMaxRating('low_ratings', channel)
}

/** The patch a choice saves: off, or on at that threshold. */
const patchOf = (value: number | null): NotificationPreferencePatch =>
  value === null
    ? { enabled: false }
    : { enabled: true, maxRating: value as LowRatingThreshold }

export function LowRatingSelect({
  channel,
  categoryLabel,
  values,
  disabled = false,
  onChange,
  className,
}: Readonly<{
  channel: Channel
  categoryLabel: string
  values: PreferenceValues | undefined
  disabled?: boolean
  onChange: (patch: NotificationPreferencePatch) => void
  className?: string
}>) {
  return (
    <RatingThresholdField
      id={`low_ratings-${channel}`}
      label={CHANNEL_LABELS[channel]}
      accessibleName={named(categoryLabel, CHANNEL_LABELS[channel])}
      offLabel="Off"
      thresholds={LOW_RATING_THRESHOLDS}
      value={valueOf(values, channel)}
      disabled={disabled}
      onValueChange={(value) => onChange(patchOf(value))}
      className={className ?? 'w-auto'}
      triggerClassName="w-40"
    />
  )
}
