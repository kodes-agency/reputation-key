// Group digest lines by Property without adding source content to headings.

import type { Notification, NotificationEmail } from '../../domain/notification-types'
import type {
  NotificationRenderContext,
  RenderedNotification,
} from '../../domain/notification-templates'
import { notificationLink, renderNotification } from '../../domain/notification-templates'
import { splitFacts } from '../email/notification-facts'
import type { DigestEmailGroup } from '../email/digest-email'

/** One deliverable digest line: the queue row plus its in-app notification. */
export type DigestItem = Readonly<{
  entry: NotificationEmail
  notification: Notification
}>

/**
 * Group one user's digest lines by property, preserving queue order within a
 * group and first-appearance order between groups using Map insertion order.
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
  /** The recipient's clock — ADR 0046 r.4 already frames the digest on it. */
  context?: NotificationRenderContext,
): ReadonlyArray<DigestEmailGroup> {
  const byProperty = new Map<string, DigestItem[]>()

  for (const item of items) {
    const key = item.entry.propertyId as string
    const group = byProperty.get(key)
    if (group) group.push(item)
    else byProperty.set(key, [item])
  }

  return [...byProperty].map(([key, group]) => {
    const propertyName = resolvePropertyHeading(key, group, propertyNames)
    return {
      propertyName,
      items: group.map(({ notification }) => {
        const link = notificationLink(
          notification.resourceType,
          notification.resourceId,
          key,
          notification.type,
          notification.payload,
        )
        const rendered = renderNotification(
          notification.type,
          notification.payload,
          context,
        )
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
    (item) => item.notification.payload.propertyName !== undefined,
  )?.notification.payload.propertyName
  return fromPayload ?? propertyNames.get(propertyId) ?? 'Property'
}
