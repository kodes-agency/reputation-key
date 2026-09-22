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

const EVERY_EMAIL_CADENCE: readonly NotificationCadence[] = ['immediate', 'daily']
const DAILY_EMAIL_ONLY: readonly NotificationCadence[] = ['daily']

/**
 * Email cadences a person may choose for a category. Goals (`recognition`)
 * are a daily digest only: one Program over up to 250 Portals closes its
 * results in the same hour, and an immediate cadence would send each as its
 * own email (ADR 0046, amended 2026-09-22).
 */
export function offeredEmailCadences(
  category: NotificationCategory,
): readonly NotificationCadence[] {
  return category === 'recognition' ? DAILY_EMAIL_ONLY : EVERY_EMAIL_CADENCE
}

/**
 * The cadence email is actually sent at. A stored cadence the category no
 * longer offers (a goal row saved as immediate before it became daily-only)
 * falls back to the category default rather than being honoured.
 */
export function effectiveEmailCadence(
  category: NotificationCategory,
  stored: NotificationCadence | undefined,
): NotificationCadence {
  return stored !== undefined && offeredEmailCadences(category).includes(stored)
    ? stored
    : getDefaultCadence(category)
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
 * ADR 0046 r.2 — absorb a repeat event into the single unread row instead of
 * stacking another one.
 *
 * The count is authoritative for the copy: `occurrences` is written into the
 * merged payload so `renderNotification` can say "Updated 3 times", and
 * title/body are re-rendered from the merged facts (a re-escalation that has
 * now waited 9 hours must not keep advertising 3).
 *
 * Payload merge is newest-wins per key: a fresh payload missing a key keeps the
 * value the row already had, because a later event that could not resolve the
 * property name should not erase the name the first one captured. A closed
 * cause is the exception: it names the remedy for one occurrence, and a fresh
 * event without one had none, so the earlier cause is dropped rather than
 * left advertising a remedy that no longer applies.
 */
export function applyCoalescence(
  existing: Notification,
  freshPayload: NotificationPayload,
  now: Date,
): Notification {
  const coalescedCount = existing.coalescedCount + 1
  const payload: NotificationPayload = {
    ...withoutOccurrenceCauses(existing.payload),
    ...freshPayload,
    occurrences: coalescedCount,
  }
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
