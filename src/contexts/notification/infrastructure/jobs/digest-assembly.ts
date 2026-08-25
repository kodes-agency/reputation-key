// Pure assembly for the daily digest: idempotency key, property grouping, and
// the ADR 0046 r.8 content boundary for the group heading.
//
// Kept separate from the job so the interesting invariants — key stability,
// grouping, "no Google content in a heading" — are testable without a pool, a
// queue, or a clock.

import { createHash } from 'node:crypto'
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

const sha256 = (domain: string, values: readonly string[]): string => {
  const hash = createHash('sha256')
  hash.update(`${domain}\0`)
  for (const value of values)
    hash.update(`${Buffer.byteLength(value, 'utf8')}:`).update(value)
  return hash.digest('hex')
}

/** Content-free fingerprint of the exact queue rows owned by one batch. */
export function digestMemberSet(emailIds: readonly string[]): string {
  return sha256('reputation-key/digest-members/v1', [...emailIds].sort())
}

/**
 * Fingerprint every provider-visible field except the idempotency key itself.
 * A retry may reuse a provider key only when this value still matches the
 * durable batch record.
 */
export function digestProviderRequest(input: {
  to: string
  subject: string
  html: string
  text: string
  headers?: Readonly<Record<string, string>>
}): string {
  const headers = Object.entries(input.headers ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return sha256('reputation-key/digest-provider-request/v1', [
    input.to,
    input.subject,
    input.html,
    input.text,
    ...headers.flatMap(([name, value]) => [name, value]),
  ])
}

/**
 * ADR 0046 r.5 — bind the provider key to an immutable batch rather than the
 * mutable set of rows that happen to be due on a local date. The digest keeps
 * the key within provider limits even when tenant/user identifiers are long.
 */
export function digestBatchIdempotencyKey(input: {
  organizationId: string
  userId: string
  localDate: string
  batchId: string
  memberDigest: string
}): string {
  const digest = sha256('reputation-key/digest-idempotency/v2', [
    input.organizationId,
    input.userId,
    input.localDate,
    input.batchId,
    input.memberDigest,
  ])
  return `rk-digest-v2:${digest}`
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
    const link = notificationLink(notification.resourceType, notification.resourceId, key)
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
