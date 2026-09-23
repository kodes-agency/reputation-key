// Where a delivery decision comes from (ADR 0046 r.3/r.4, amended 2026-09-23).
//
// Quiet hours and the urgent bypass used to be stored per
// (Property, category, channel). A manager with 30 Properties needed about 60
// saves to stop 03:00 email, and a window set on only some of them split the
// one digest ADR 0046 r.4 promises into two — the rows of the quiet Properties
// were deferred while the rest went out. They are now the PERSON's, stored
// beside their timezone, with an optional per-Property override.
//
// The per-category enabled/cadence choice stays per Property, because a
// Property is exactly what a person wants to be noisy or quiet about. What was
// missing is a default: a Property added or reassigned after the person
// configured everything else had no row at all and fell back to the versioned
// defaults, which is how urgent email arrived at 03:00 on a Property nobody had
// ever seen. `personalDefault` is that inheritance.

import { effectiveEmailCadence } from './notification-cadence'
import { getDefaultCadence, getDefaultEnabled } from './notification-policy'
import type {
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
  PersonalDeliveryWindow,
} from './notification-types'

/** Never held back, and no urgent bypass to speak of. */
export const NO_QUIET_HOURS: PersonalDeliveryWindow = {
  quietHoursStart: null,
  quietHoursEnd: null,
  urgentBypassEnabled: false,
}

/**
 * The window delivery evaluates for one recipient at one Property.
 *
 * An override replaces the person's window WHOLE rather than merging field by
 * field: the row exists because someone deliberately said "this Property is
 * different", and an override that kept the personal urgent bypass would be a
 * setting nobody chose. An override with no times is therefore a real answer —
 * "never hold anything back here" — not an absent one.
 */
export function resolveDeliveryWindow(
  personal: PersonalDeliveryWindow | null,
  propertyOverride: PersonalDeliveryWindow | null,
): PersonalDeliveryWindow {
  return propertyOverride ?? personal ?? NO_QUIET_HOURS
}

/** What one (category, channel) resolves to for delivery. */
export type CategoryPreferenceValues = Readonly<{
  enabled: boolean
  cadence: NotificationCadence
}>

/**
 * The Property's own row, else the person's default for the category, else the
 * versioned defaults (ADR 0046 r.1 — never "both on"). The stored cadence is
 * read through `effectiveEmailCadence`, so a goal row saved as immediate before
 * goals became daily-only is still delivered in the digest.
 */
export function resolveCategoryPreference(
  input: Readonly<{
    category: NotificationCategory
    channel: NotificationChannel
    property: CategoryPreferenceValues | null
    personalDefault: CategoryPreferenceValues | null
  }>,
): CategoryPreferenceValues {
  const chosen = input.property ?? input.personalDefault
  const cadence = chosen?.cadence ?? getDefaultCadence(input.category)
  return {
    enabled: chosen?.enabled ?? getDefaultEnabled(input.category, input.channel),
    cadence:
      input.channel === 'email'
        ? effectiveEmailCadence(input.category, cadence)
        : cadence,
  }
}
