// Pure assembly for the daily digest: idempotency key, property grouping, and
// the ADR 0046 r.8 content boundary for the group heading.
//
// Kept separate from the job so the interesting invariants — key stability,
// grouping, "no Google content in a heading" — are testable without a pool, a
// queue, or a clock.

import type { Notification, NotificationEmail } from '../../domain/notification-types'
import type { RenderedNotification } from '../../domain/notification-templates'
import { notificationLink, renderNotification } from '../../domain/notification-templates'
import { splitFacts } from '../email/notification-facts'
import {
  digestBatchIdempotencyKey,
  digestMemberSet,
  digestProviderRequest,
} from '../digest-batch-identity'

export { digestBatchIdempotencyKey, digestMemberSet, digestProviderRequest }

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
  const byProperty = new Map<string, DigestItem[]>()

  for (const item of items) {
    const key = item.entry.propertyId as string
    if (!byProperty.has(key)) {
      byProperty.set(key, [])
      order.push(key)
    }
    byProperty.get(key)!.push(item)
  }

  return order.map((key) => {
    const propertyName = resolvePropertyHeading(key, items, propertyNames)
    return {
      propertyName,
      items: byProperty.get(key)!.map(({ notification }) => {
        const link = notificationLink(
          notification.resourceType,
          notification.resourceId,
          key,
          notification.type,
        )
        const rendered = renderNotification(notification.type, notification.payload)
        return {
          rendered: withoutFact(rendered, propertyName),
          actionUrl: buildActionUrl(link.path, link.search),
        }
      }),
    }
  })
}

/**
 * The group heading already names the Property, and each title says it again,
 * so the line's facts drop it rather than name it a third time.
 */
const withoutFact = (
  rendered: RenderedNotification,
  fact: string,
): RenderedNotification => ({
  ...rendered,
  summary: splitFacts(rendered.summary)
    .filter((candidate) => candidate !== fact)
    .join(' · '),
})

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
