// Pure assembly for the daily digest: idempotency key, property grouping, and
// the ADR 0046 r.8 content boundary for the group heading.
//
// Kept separate from the job so the interesting invariants — key stability,
// grouping, "no Google content in a heading" — are testable without a pool, a
// queue, or a clock.

import type { Notification, NotificationEmail } from '../../domain/types'
import type { RenderedNotification } from '../../domain/notification-templates'
import { notificationLink, renderNotification } from '../../domain/notification-templates'

/** One deliverable digest line: the queue row plus its in-app notification. */
export type DigestItem = Readonly<{
  entry: NotificationEmail
  notification: Notification
}>

/** Exactly the shape `renderDigestEmail` consumes. */
export type DigestGroup = Readonly<{
  propertyName: string
  items: ReadonlyArray<Readonly<{ rendered: RenderedNotification; actionUrl: string }>>
}>

/**
 * ADR 0046 r.5 — the application idempotency key must outlive the provider's
 * 24-hour dedupe window.
 *
 * Two properties matter and both are structural, not incidental:
 *   1. It contains NO timestamp, only the recipient's LOCAL DATE. A retry an
 *      hour later, a day later, or after a worker restart recomputes the exact
 *      same key, so the provider collapses the duplicate even if our own state
 *      write was the thing that failed.
 *   2. It is keyed on (organization, user, local date) and NOT on property.
 *      ADR 0046 r.4 is one digest per user; keying on property is precisely the
 *      bug that produced one digest per property.
 *
 * Beyond 24h the provider forgets, which is why the durable guard is the queue
 * row status: an accepted row is no longer "due", so a later sweep finds
 * nothing to send. The key handles the fast retry, the status handles the slow
 * one.
 */
export function digestIdempotencyKey(
  organizationId: string,
  userId: string,
  localDate: string,
): string {
  return `digest:${organizationId}:${userId}:${localDate}`
}

/**
 * Group one user's digest lines by property, preserving queue order within a
 * group and first-appearance order between groups (so the email is stable
 * across sweeps rather than reordering with a Map's hash).
 *
 * ADR 0046 r.8: the heading uses the property DISPLAY NAME — allowed — and
 * nothing else. `payload.propertyName` is the primary source because it was
 * captured at event time and is already content-boundary filtered; the resolved
 * org property-name map is the fallback for rows written before payloads
 * existed. `Property` is the last resort: a heading of a bare UUID is exactly
 * the defect this overhaul exists to remove.
 */
export function groupItemsByProperty(
  items: ReadonlyArray<DigestItem>,
  propertyNames: ReadonlyMap<string, string>,
  buildActionUrl: (path: string, search: Readonly<Record<string, string>>) => string,
): ReadonlyArray<DigestGroup> {
  const order: string[] = []
  const byProperty = new Map<string, DigestGroup['items'][number][]>()

  for (const { entry, notification } of items) {
    const key = entry.propertyId as string
    if (!byProperty.has(key)) {
      byProperty.set(key, [])
      order.push(key)
    }
    const link = notificationLink(
      notification.resourceType,
      notification.resourceId,
      key,
    )
    byProperty.get(key)!.push({
      rendered: renderNotification(notification.type, notification.payload),
      actionUrl: buildActionUrl(link.path, link.search),
    })
  }

  return order.map((key) => ({
    propertyName: resolvePropertyHeading(key, items, propertyNames),
    items: byProperty.get(key)!,
  }))
}

function resolvePropertyHeading(
  propertyId: string,
  items: ReadonlyArray<DigestItem>,
  propertyNames: ReadonlyMap<string, string>,
): string {
  const fromPayload = items.find(
    (item) =>
      (item.entry.propertyId as string) === propertyId &&
      item.notification.payload.propertyName !== undefined,
  )?.notification.payload.propertyName
  return fromPayload ?? propertyNames.get(propertyId) ?? 'Property'
}
