// Low ratings: how low a review or rated private feedback must be for each
// channel to tell the person (ADR 0046, amended 2026-09-30). In place of the
// on/off switch every other category has, each channel offers "Off" or a
// star threshold, 1★ to 4★; 3★ or lower in the app and 2★ or lower by email
// until the person chooses.

import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  getDefaultEnabled,
  getDefaultMaxRating,
  LOW_RATING_THRESHOLDS,
  type LowRatingThreshold,
} from '#/contexts/feed/application/public-api'
import type { NotificationPreferencePatch } from './notifications-settings-view'
import type { PreferenceValues } from './notification-preference-saves'
import { lowRatingWords, spokenLowRatingWords } from './notification-inherited-defaults'
import { named } from './notification-default-controls'

const OFF = 'off'

const CHANNEL_LABELS = { in_app: 'In the app', email: 'By email' } as const

type Channel = keyof typeof CHANNEL_LABELS

/** What the select shows: "off", or the threshold as a string. */
const valueOf = (values: PreferenceValues | undefined, channel: Channel): string => {
  const enabled = values?.enabled ?? getDefaultEnabled('low_ratings', channel)
  if (!enabled) return OFF
  return String(values?.maxRating ?? getDefaultMaxRating('low_ratings', channel))
}

/** The patch a choice saves: off, or on at that threshold. */
const patchOf = (value: string): NotificationPreferencePatch =>
  value === OFF
    ? { enabled: false }
    : { enabled: true, maxRating: Number(value) as LowRatingThreshold }

/**
 * "3★ or lower" on screen and "3 stars or lower" read aloud — in the list and,
 * since the select shows the chosen option's text, once chosen.
 */
function ThresholdWords({ threshold }: Readonly<{ threshold: LowRatingThreshold }>) {
  return (
    <>
      <span aria-hidden="true">{lowRatingWords(threshold)}</span>
      <span className="sr-only">{spokenLowRatingWords(threshold)}</span>
    </>
  )
}

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
  const id = `low_ratings-${channel}`
  return (
    <Field className={className ?? 'w-auto'}>
      <FieldLabel htmlFor={id}>{CHANNEL_LABELS[channel]}</FieldLabel>
      <Select
        value={valueOf(values, channel)}
        disabled={disabled}
        onValueChange={(value) => onChange(patchOf(value))}
      >
        <SelectTrigger
          id={id}
          aria-label={named(categoryLabel, CHANNEL_LABELS[channel])}
          className="w-40 min-w-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={OFF}>Off</SelectItem>
            {LOW_RATING_THRESHOLDS.map((threshold) => (
              <SelectItem
                key={threshold}
                value={String(threshold)}
                textValue={spokenLowRatingWords(threshold)}
              >
                <ThresholdWords threshold={threshold} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
