// Notification context — category/channel default policy + ADR 0046 r.2
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

import type { NotificationCategory, NotificationChannel, Notification } from './types'
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

// Categories where the preference cannot be disabled by the user
const NON_DISABLEABLE: ReadonlySet<string> = new Set(['mandatory'])

export function getDefaultEnabled(
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  return DEFAULT_POLICY[category]?.[channel] ?? false
}

/**
 * ADR 0046: a genuinely mandatory (account/security/legal) category may not be
 * switched off. Enforced at the write path by `createNotificationPreference`.
 */
export function isDisableable(category: NotificationCategory): boolean {
  return !NON_DISABLEABLE.has(category)
}

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
 * property name should not erase the name the first one captured.
 */
export function applyCoalescence(
  existing: Notification,
  freshPayload: NotificationPayload,
  now: Date,
): Notification {
  const coalescedCount = existing.coalescedCount + 1
  const payload: NotificationPayload = {
    ...existing.payload,
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
