// Notification context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type {
  NotificationId,
  NotificationEmailId,
  NotificationPreferenceId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'
import type { NotificationPayload } from './notification-payload'

// ── Notification types (single source of truth) ───────────────────
// NOTIFICATION_TYPES is the canonical list; NotificationType and every
// runtime validator (ALLOWED_TYPES, VALID_TYPES, the zod enum) derive
// from it. Add a type here once and it propagates everywhere.
// Each type corresponds to a specific domain event subscription.
// Names are user-facing (for preferences, templates, filtering).

export const NOTIFICATION_TYPES = [
  // Review events
  'review.created',
  // Inbox events (feedback only — reviews use review.created)
  'feedback.created',
  // Reply lifecycle
  'reply.pending_approval',
  'reply.approved',
  'reply.rejected',
  'reply.published',
  'reply.publish_failed',
  // Inbox triage
  'inbox.escalated',
  'inbox.assigned',
  'inbox_note.added',
  // Goal events
  'goal.completed',
  // Badge events
  'badge.awarded',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// ── Delivery policy ────────────────────────────────────────────────

export type NotificationPriority = 'urgent' | 'normal'
/**
 * ADR 0046 categories, minus `digest_summary`.
 *
 * A digest is a CADENCE, not a category: the digest job selects on
 * `cadence = 'daily'` and the preferences UI already offers immediate|daily per
 * category, so a `digest_summary` category was a second expression of the same
 * axis — and, defaulting to {in_app:false, email:false}, it silently swallowed
 * every `goal.completed`. Migration 0070 remaps stored rows to `recognition`.
 */
export type NotificationCategory =
  'mandatory' | 'urgent_operational' | 'workflow_collaboration' | 'recognition'
export type NotificationChannel = 'in_app' | 'email'
export type NotificationCadence = 'immediate' | 'daily'
export type NotificationStatus = 'unread' | 'read' | 'dismissed'
export type EmailQueueStatus =
  | 'pending'
  | 'accepted'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'
  | 'cancelled'
export type DeliveryErrorClass = 'transient' | 'permanent' | 'suppressed'
export type NotificationResourceType = 'inbox_item' | 'reply' | 'goal' | 'badge'

// ── In-app notification ─────────────────────────────────────────────

export type Notification = Readonly<{
  id: NotificationId
  userId: UserId
  organizationId: OrganizationId
  propertyId: PropertyId
  type: NotificationType
  category: NotificationCategory
  priority: NotificationPriority
  status: NotificationStatus
  resourceType: NotificationResourceType
  resourceId: string
  eventId: string
  /**
   * Rendered snapshot kept for pre-template rows and as a defensive fallback.
   * Live surfaces render from `type` + `payload` via `renderNotification`.
   */
  title: string
  body: string | null
  /** Content-free render metadata (ADR 0046 r.8). `{}` when nothing was captured. */
  payload: NotificationPayload
  /** ADR 0046 r.2: how many events this unread row has absorbed. Always >= 1. */
  coalescedCount: number
  /** When the most recent absorbed event arrived. Null when never coalesced. */
  coalescedLatestAt: Date | null
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
  propertyId: PropertyId
  category: NotificationCategory
  cadence: NotificationCadence
  status: EmailQueueStatus
  priority: NotificationPriority
  idempotencyKey: string
  providerMessageId: string | null
  providerState: string | null
  lastErrorClass: DeliveryErrorClass | null
  suppressionReason: string | null
  notBefore: Date | null
  nextAttemptAt: Date | null
  attemptedAt: Date | null
  acceptedAt: Date | null
  deliveredAt: Date | null
  bouncedAt: Date | null
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
  propertyId: PropertyId
  category: NotificationCategory
  channel: NotificationChannel
  enabled: boolean
  cadence: NotificationCadence
  urgentBypassEnabled: boolean
  quietHoursStart: string | null
  quietHoursEnd: string | null
  createdAt: Date
  updatedAt: Date
}>

export type NotificationUserSettings = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  locale: string
  timezone: string
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
