// ADR 0046 r.3 — recipient timezone resolution.
//
// The delivery jobs used to run on the PROPERTY timezone, which is the wrong
// clock for a person: a manager in Sofia looking after a Denver hotel got their
// quiet hours and their 08:00 digest on Denver time. The ADR fixes the order of
// preference at "user IANA timezone, organization fallback".
//
// `notification_user_settings.timezone` has been written by
// `updateNotificationUserSettingsFn` since migration 0026 and read by nothing.
// This is the read.
//
// Every candidate is validated before it is returned, because an unresolvable
// IANA name is a RangeError thrown from inside `Intl.DateTimeFormat` — i.e. deep
// inside `deliveryTiming`, mid-sweep, aborting the whole digest for every other
// recipient. Falling through to the next candidate keeps one bad row local.

/** Ordered candidates, most specific first. */
export type RecipientTimezoneSources = Readonly<{
  /** `notification_user_settings.timezone` for this (user, organization). */
  userTimezone?: string | null
  /** Representative timezone for the organization. */
  organizationTimezone?: string | null
  /**
   * Last resort before UTC. Only the urgent path has one — a single urgent
   * email is scoped to one property, so that property's clock is a better
   * guess than UTC when the user never chose a timezone.
   */
  propertyTimezone?: string | null
}>

const UTC_FALLBACK = 'UTC'

/**
 * True when `Intl` can actually resolve the zone. `Intl.supportedValuesOf` is
 * not usable here: it omits link/alias names (`Asia/Calcutta`) that are still
 * perfectly resolvable and stored in real rows.
 */
export function isResolvableTimezone(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

/**
 * First resolvable candidate, else UTC. Never throws — a recipient with three
 * unusable timezone values still gets mail, just on UTC.
 */
export function resolveRecipientTimezone(sources: RecipientTimezoneSources): string {
  const ordered = [
    sources.userTimezone,
    sources.organizationTimezone,
    sources.propertyTimezone,
  ]
  return ordered.find(isResolvableTimezone) ?? UTC_FALLBACK
}

/**
 * Which candidate won, for the log line. Delivery timing is the single most
 * confusing thing to support ("why did this arrive at 3am?"), and the answer is
 * always "which timezone did we pick and why".
 */
export type RecipientTimezoneSource = 'user' | 'organization' | 'property' | 'default'

export function recipientTimezoneSource(
  sources: RecipientTimezoneSources,
): RecipientTimezoneSource {
  if (isResolvableTimezone(sources.userTimezone)) return 'user'
  if (isResolvableTimezone(sources.organizationTimezone)) return 'organization'
  if (isResolvableTimezone(sources.propertyTimezone)) return 'property'
  return 'default'
}

/** `2026-08-21` in the recipient's zone — the digest's local-date key. */
export function localDateKey(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** `Friday, 21 August` — the human date for the digest subject and heading. */
export function localDateLabel(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now)
}
