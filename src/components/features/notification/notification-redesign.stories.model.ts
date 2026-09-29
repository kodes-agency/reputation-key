// DESIGN PROTOTYPE — story-only. The pure half of the redesign prototypes:
// which rows need their reader, how they sort, stack and group by date. The
// components that draw them are in notification-redesign.stories.parts.tsx.

import {
  isStillWaiting,
  type NotificationType,
  type NotificationView,
} from '#/contexts/feed/application/public-api'

// ── Domain-grounded classification ──────────────────────────────────
// Mirrors ACTIONABLE_NOTIFICATION_TYPES (notification-settlement.ts): the
// types that stand for work still waiting on their reader. `inbox.assigned`
// is added deliberately — see the open decision in the proposal.
const NEEDS_YOU_TYPES: ReadonlySet<NotificationType> = new Set([
  'review.created',
  'review.updated',
  'feedback.created',
  'reply.pending_approval',
  'reply.publish_failed',
  'inbox.escalated',
  'inbox.reopened',
  'inbox.bulk_reopened',
  'inbox.response_target_halfway',
  'inbox.response_target_passed',
  'inbox.assigned',
  'property.responsibility_needed',
  'portal.responsibility_needed',
  'integration.reauthorization_required',
  'portal.health_attention',
  'account.organization_purge_pending',
])

export const needsYou = (n: NotificationView): boolean =>
  NEEDS_YOU_TYPES.has(n.type) && isStillWaiting(n)

/** Most time-critical first: passed targets, then urgent, then the rest by age. */
export const byUrgency = (a: NotificationView, b: NotificationView): number => {
  const rank = (n: NotificationView) =>
    n.type === 'inbox.response_target_passed' ? 0 : n.priority === 'urgent' ? 1 : 2
  return rank(a) - rank(b) || stampOf(b).getTime() - stampOf(a).getTime()
}

// Bodies that restate the title or only say "open it". The row drops them and
// lets the facts line speak. Real implementation: a template-level flag.
export const BOILERPLATE_BODY: ReadonlySet<NotificationType> = new Set([
  'review.created',
  'review.updated',
  'feedback.created',
  'reply.pending_approval',
  'reply.approved',
  'reply.published',
  'inbox.escalated',
  'inbox.escalation_resolved',
  'inbox.assigned',
  'inbox.unassigned',
  'inbox_note.added',
  'inbox.response_target_halfway',
  'inbox.response_target_passed',
  'goal.completed',
])

export const stampOf = (n: NotificationView): Date => n.coalescedLatestAt ?? n.createdAt

// ── Compact time ────────────────────────────────────────────────────

const NOW = Date.now()

export function compactTime(date: Date): string {
  const minutes = Math.round((NOW - date.getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export type DateBucket = 'Today' | 'Yesterday' | 'Earlier this week' | 'Older'

export function dateBucket(date: Date): DateBucket {
  const hours = (NOW - date.getTime()) / 3_600_000
  if (hours < 24) return 'Today'
  if (hours < 48) return 'Yesterday'
  if (hours < 24 * 7) return 'Earlier this week'
  return 'Older'
}

export function groupByDate(
  rows: ReadonlyArray<NotificationView>,
): ReadonlyArray<Readonly<{ label: DateBucket; rows: NotificationView[] }>> {
  const order: DateBucket[] = ['Today', 'Yesterday', 'Earlier this week', 'Older']
  return order
    .map((label) => ({
      label,
      rows: rows.filter((n) => dateBucket(stampOf(n)) === label),
    }))
    .filter((group) => group.rows.length > 0)
}

// ── Stacking ────────────────────────────────────────────────────────
// Arrivals of one kind at one Property read as one line: "3 new reviews". The
// server already coalesces repeats of ONE item (coalescedCount); this folds
// separate items of the same kind, which the server keeps apart on purpose.

export const STACK_NOUNS: Partial<Record<NotificationType, (count: number) => string>> = {
  'review.created': (c) => `${c} new reviews`,
  'feedback.created': (c) => `${c} new guest feedback`,
  'inbox_note.added': (c) => `${c} new internal notes`,
  'reply.published': (c) => `${c} replies live on Google`,
}

export type FeedEntry =
  | Readonly<{ kind: 'row'; row: NotificationView }>
  | Readonly<{ kind: 'stack'; key: string; rows: NotificationView[] }>

export function stackEntries(rows: ReadonlyArray<NotificationView>): FeedEntry[] {
  const entries: FeedEntry[] = []
  const stacks = new Map<string, NotificationView[]>()
  for (const row of rows) {
    const stackable = STACK_NOUNS[row.type] !== undefined
    const key = `${row.type}|${row.propertyId ?? 'org'}|${row.status}`
    const existing = stackable ? stacks.get(key) : undefined
    if (existing) {
      existing.push(row)
      continue
    }
    if (stackable) {
      const bucket = [row]
      stacks.set(key, bucket)
      entries.push({ kind: 'stack', key, rows: bucket })
      continue
    }
    entries.push({ kind: 'row', row })
  }
  return entries.map((entry) =>
    entry.kind === 'stack' && entry.rows.length === 1
      ? { kind: 'row', row: entry.rows[0]! }
      : entry,
  )
}

// ── Tone ────────────────────────────────────────────────────────────

export type RowTone = 'critical' | 'needs-you' | 'update' | 'done'

export function toneOf(n: NotificationView): RowTone {
  if (n.resolvedAt !== null) return 'done'
  if (!needsYou(n)) return 'update'
  if (n.priority === 'urgent' || n.type === 'inbox.response_target_passed')
    return 'critical'
  return 'needs-you'
}
