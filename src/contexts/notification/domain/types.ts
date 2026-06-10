// Notification context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type {
  NotificationId,
  NotificationEmailId,
  NotificationPreferenceId,
  UserId,
  OrganizationId,
} from '#/shared/domain/ids'

// ── Notification types ──────────────────────────────────────────────
// Each type corresponds to a specific domain event subscription.
// Names are user-facing (for preferences, templates, filtering).

export type NotificationType =
  // Review events
  | 'review.created'
  // Inbox events (feedback only — reviews use review.created)
  | 'feedback.created'
  // Reply lifecycle
  | 'reply.pending_approval'
  | 'reply.approved'
  | 'reply.rejected'
  | 'reply.published'
  | 'reply.publish_failed'
  // Inbox triage
  | 'inbox.escalated'
  | 'inbox.assigned'
  | 'inbox_note.added'
  // Goal events
  | 'goal.completed'

// ── Priority ────────────────────────────────────────────────────────
// Urgent = immediate email. Normal = digest only.

export type NotificationPriority = 'urgent' | 'normal'

// ── Status ──────────────────────────────────────────────────────────

export type NotificationStatus = 'unread' | 'read' | 'dismissed'

export type EmailQueueStatus = 'pending' | 'sent' | 'failed' | 'skipped'

// ── Resource types (for routing) ────────────────────────────────────

export type NotificationResourceType = 'inbox_item' | 'reply' | 'goal'

// ── In-app notification ─────────────────────────────────────────────

export type Notification = Readonly<{
  id: NotificationId
  userId: UserId
  organizationId: OrganizationId
  type: NotificationType
  priority: NotificationPriority
  status: NotificationStatus
  resourceType: NotificationResourceType
  resourceId: string
  eventId: string
  title: string
  body: string | null
  readAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

// ── Email queue entry ───────────────────────────────────────────────

export type NotificationEmail = Readonly<{
  id: NotificationEmailId
  notificationId: NotificationId
  userId: UserId
  organizationId: OrganizationId
  status: EmailQueueStatus
  priority: NotificationPriority
  sentAt: Date | null
  failedAt: Date | null
  retryCount: number
  createdAt: Date
  updatedAt: Date
}>

// ── Notification preferences ────────────────────────────────────────

export type NotificationPreference = Readonly<{
  id: NotificationPreferenceId
  userId: UserId
  organizationId: OrganizationId
  type: NotificationType
  emailEnabled: boolean
  inAppEnabled: boolean
  createdAt: Date
  updatedAt: Date
}>

// ── Urgent types (Q9 decision) ──────────────────────────────────────

export const URGENT_TYPES: ReadonlySet<NotificationType> = new Set([
  'reply.pending_approval',
  'reply.publish_failed',
  'inbox.escalated',
])

export const isUrgent = (type: NotificationType): boolean => URGENT_TYPES.has(type)
