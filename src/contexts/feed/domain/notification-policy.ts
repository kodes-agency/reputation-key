// Feed notification surface — category/channel default policy + ADR 0046 r.2
// coalescing.
//
// Per ADR 0046:
// - Missing preference rows resolve through this versioned default policy, not
//   "both on" (r.1). `getDefaultEnabled` is that resolution.
// - At most one UNREAD row per (user, type, resource); a repeat event bumps
//   count/latest instead of stacking a row (r.2). `applyCoalescence` is that
//   bump, and the partial unique index
//   `notifications_unread_resource_unique` is its database backstop.
//
// The lookup half of r.2 is a DB query (`findUnreadByUserTypeResource`), not an
// in-memory scan: an earlier draft of this file carried a `shouldCoalesce` over
// an in-memory `NotificationItem[]`, plus a `resolvePreference` over an
// in-memory preference array and a `buildCoalescingKey` string — a second,
// never-wired model of the same rules. They are gone; this file now holds only
// what the write path actually calls.

import type {
  Notification,
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
} from './notification-types'
import type { NotificationPayload } from './notification-payload'
import { renderNotification } from './notification-templates'

export type { NotificationCategory, NotificationChannel }

/**
 * ADR 0046 default policy. Every remaining category is ON in-app: an in-app
 * row costs nothing and a category that is off on both channels persists
 * nothing at all (which is exactly how `goal.completed` used to vanish).
 * Email stays opt-in outside mandatory/urgent.
 */
const DEFAULT_POLICY: Readonly<
  Record<NotificationCategory, Readonly<Record<NotificationChannel, boolean>>>
> = {
  mandatory: { in_app: true, email: true },
  urgent_operational: { in_app: true, email: true },
  workflow_collaboration: { in_app: true, email: false },
  recognition: { in_app: true, email: false },
}

export function getDefaultEnabled(
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  return DEFAULT_POLICY[category]?.[channel] ?? false
}

/**
 * The language a user who never saved one formats notifications in: the
 * `notification_user_settings.locale` column default.
 */
export const DEFAULT_NOTIFICATION_LOCALE = 'en'

export function getDefaultCadence(category: NotificationCategory): NotificationCadence {
  return category === 'mandatory' || category === 'urgent_operational'
    ? 'immediate'
    : 'daily'
}

/**
 * Mandatory service/security delivery cannot be disabled on either channel.
 * Action Required is always retained in-app, while its email remains
 * configurable (immediate by default, daily, or off).
 */
export function isPreferenceDisableable(
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  if (category === 'mandatory') return false
  return !(category === 'urgent_operational' && channel === 'in_app')
}

/** Payload keys that describe one occurrence rather than the resource. */
const OCCURRENCE_CAUSE_KEYS: ReadonlySet<string> = new Set<keyof NotificationPayload>([
  'publishFailureCause',
  'reauthorizationCause',
])

const withoutOccurrenceCauses = (payload: NotificationPayload): NotificationPayload =>
  Object.fromEntries(
    Object.entries(payload).filter(([key]) => !OCCURRENCE_CAUSE_KEYS.has(key)),
  ) as NotificationPayload

/**
 * The row's coalescing count, projected into the payload the copy reads. The
 * `coalesced_count` column is the one record of how often a row repeated; the
 * read projects it here so every surface says the same number, including a
 * row the insert race coalesced without touching its payload.
 */
export function withRepeatCount(
  payload: NotificationPayload,
  coalescedCount: number,
): NotificationPayload {
  const { occurrences: _stale, ...rest } = payload
  return coalescedCount > 1 ? { ...rest, occurrences: coalescedCount } : rest
}

const MS_PER_HOUR = 3_600_000

/**
 * How long the wait had lasted when the row's latest event was raised,
 * projected into the payload the copy reads. The read measures to the row's
 * own time, never the reader's clock: the item may have been answered since,
 * and an age that kept growing would say it is still waiting.
 */
export function withWaitAtNotice(
  payload: NotificationPayload,
  raisedAt: Date,
): NotificationPayload {
  const { waitedHours: _stale, ...rest } = payload
  if (rest.waitingSince === undefined) return rest
  const waited = raisedAt.getTime() - Date.parse(rest.waitingSince)
  return { ...rest, waitedHours: Math.max(0, Math.floor(waited / MS_PER_HOUR)) }
}

/**
 * A wait is what the event that measured it saw. A repeat event that measured
 * none (the item was answered or closed, or its target met) ended it, so the
 * row's earlier wait goes rather than surviving the newest-wins merge.
 */
const withoutEarlierWait = ({
  waitingSince: _since,
  waitedHours: _waited,
  ...rest
}: NotificationPayload): NotificationPayload => rest

/**
 * ADR 0046 r.2 — absorb a repeat event into the single unread row instead of
 * stacking another one.
 *
 * The count is authoritative for the copy: it is written into the merged
 * payload so `renderNotification` can say "3 notes added", and title/body are
 * re-rendered from the merged facts.
 *
 * Payload merge is newest-wins per key: a fresh payload missing a key keeps the
 * value the row already had, because a later event that could not resolve the
 * property name should not erase the name the first one captured. Two facts
 * are the exception, because each describes one occurrence rather than the
 * resource: a closed cause names the remedy for one occurrence, and a fresh
 * event without one had none, so the earlier cause is dropped rather than
 * left advertising a remedy that no longer applies
 * (`withoutOccurrenceCauses`); and a wait ends when a repeat event measured
 * none (`withoutEarlierWait`). A publish failure's `publishOutcome` needs no
 * exception: every publish failure fact now carries one, so the newest wins.
 */
export function applyCoalescence(
  existing: Notification,
  freshPayload: NotificationPayload,
  now: Date,
): Notification {
  const coalescedCount = existing.coalescedCount + 1
  const payload = withRepeatCount(
    { ...withoutEarlierWait(withoutOccurrenceCauses(existing.payload)), ...freshPayload },
    coalescedCount,
  )
  const rendered = renderNotification(existing.type, payload)
  return {
    ...existing,
    title: rendered.title,
    body: rendered.body === '' ? null : rendered.body,
    payload,
    coalescedCount,
    coalescedLatestAt: now,
    updatedAt: now,
  }
}
