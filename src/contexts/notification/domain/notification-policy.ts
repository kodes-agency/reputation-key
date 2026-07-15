// POST-BETA-4 PB4.5: Notification category/channel preferences model.
//
// Per ADR 0046:
// - Explicit category × channel × property preferences with versioned defaults.
// - Missing preference rows resolve through code/versioned default policy.
// - Coalescing: at most one unread item per (user, type, resource).
// - User IANA timezone with organization fallback.
// - Application idempotency key persists beyond provider's 24-hour dedupe.

export type NotificationCategory =
  | 'mandatory'
  | 'urgent_operational'
  | 'workflow_collaboration'
  | 'digest_summary'
  | 'recognition'

export type NotificationChannel = 'in_app' | 'email'

export type DeliveryState =
  | 'pending'
  | 'accepted'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'
  | 'cancelled'

export interface NotificationPreference {
  readonly id: string
  readonly userId: string
  readonly organizationId: string
  readonly category: NotificationCategory
  readonly channel: NotificationChannel
  readonly enabled: boolean
  readonly propertyFilter: string | null
  readonly version: number
}

export interface NotificationItem {
  readonly id: string
  readonly userId: string
  readonly organizationId: string
  readonly category: NotificationCategory
  readonly resourceType: string
  readonly resourceId: string
  readonly title: string
  readonly bodyPreview: string
  readonly readAt: Date | null
  readonly createdAt: Date
  readonly coalescedCount: number
  readonly coalescedLatestAt: Date
  readonly deliveryState: DeliveryState
  readonly applicationIdempotencyKey: string
  readonly providerMessageId: string | null
}

// Default policy per ADR 0046
const DEFAULT_POLICY: Readonly<
  Record<NotificationCategory, Readonly<Record<NotificationChannel, boolean>>>
> = {
  mandatory: { in_app: true, email: true },
  urgent_operational: { in_app: true, email: true },
  workflow_collaboration: { in_app: true, email: false },
  digest_summary: { in_app: false, email: false },
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

export function isDisableable(category: NotificationCategory): boolean {
  return !NON_DISABLEABLE.has(category)
}

export function resolvePreference(
  preferences: readonly NotificationPreference[],
  userId: string,
  organizationId: string,
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  const pref = preferences.find(
    (p) =>
      p.userId === userId &&
      p.organizationId === organizationId &&
      p.category === category &&
      p.channel === channel,
  )
  if (pref) return pref.enabled
  return getDefaultEnabled(category, channel)
}

/**
 * Check if a notification should coalesce with an existing item.
 * Per ADR 0046: at most one unread item per (user, type, resource).
 */
export function shouldCoalesce(
  existing: readonly NotificationItem[],
  userId: string,
  resourceType: string,
  resourceId: string,
): NotificationItem | null {
  return (
    existing.find(
      (n) =>
        n.userId === userId &&
        n.resourceType === resourceType &&
        n.resourceId === resourceId &&
        n.readAt === null,
    ) ?? null
  )
}

/**
 * Coalesce a new notification into an existing unread item.
 * Per ADR 0046: bump count/latest while preserving event relation.
 */
export function applyCoalescence(
  existing: NotificationItem,
  newTimestamp: Date,
): NotificationItem {
  return {
    ...existing,
    coalescedCount: existing.coalescedCount + 1,
    coalescedLatestAt: newTimestamp,
  }
}

/**
 * Build the coalescing key for a notification.
 * Per ADR 0046: NOT event ID — use (user, type, resource).
 */
export function buildCoalescingKey(
  userId: string,
  resourceType: string,
  resourceId: string,
): string {
  return `${userId}:${resourceType}:${resourceId}`
}
