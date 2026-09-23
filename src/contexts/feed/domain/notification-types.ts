// Feed notification surface — domain types
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
  // Organization account/security events
  'account.organization_access_granted',
  'account.organization_role_changed',
  'account.organization_access_removed',
  // LIF-01 program bullet 5: the MANDATORY final notice at Purge Pending.
  // Closing suppresses ordinary product mail; this one is carved out, because
  // it is the last chance anybody has to stop an irreversible erasure.
  'account.organization_purge_pending',
  // Review events
  'review.created',
  'review.updated',
  // Inbox events (feedback only — reviews use review.created)
  'feedback.created',
  // Reply lifecycle
  'reply.pending_approval',
  'reply.approved',
  'reply.rejected',
  'reply.published',
  'reply.publish_failed',
  // An approved reply was returned to draft before Google ever saw it.
  'reply.publication_cancelled',
  // Inbox triage
  'inbox.escalated',
  'inbox.escalation_resolved',
  'inbox.reopened',
  'inbox.bulk_reopened',
  'inbox.response_target_halfway',
  'inbox.response_target_passed',
  'inbox.assigned',
  'inbox.bulk_assigned',
  // A departing or newly ineligible member's items now belong to nobody.
  'inbox.assignments_released',
  /** The item moved to somebody else; the previous holder is told (I15). */
  'inbox.unassigned',
  'inbox_note.added',
  // Portal operations
  'portal.responsibility_needed',
  'portal.health_attention',
  'property.responsibility_needed',
  'integration.reauthorization_required',
  // Somebody deliberately disconnected the Organization's Google account.
  'integration.google_disconnected',
  // Goal events
  'goal.completed',
  'goal.result_revised',
  // A beta report the recipient filed reached an outcome (ADR 0059).
  'beta_feedback.outcome',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// ── Delivery policy ────────────────────────────────────────────────

export type NotificationPriority = 'urgent' | 'normal'
/**
 * ADR 0046 categories, minus `digest_summary`.
 *
 * A digest is a CADENCE, not a category: the digest job selects on
 * `cadence = 'daily'` and the preferences UI already offers a cadence per
 * category (daily only for goals), so a `digest_summary` category was a second
 * expression of the same axis — and, defaulting to {in_app:false, email:false},
 * it silently swallowed every `goal.completed`. Migration 0070 remaps stored
 * rows to `recognition`.
 */
export type NotificationCategory =
  'mandatory' | 'urgent_operational' | 'workflow_collaboration' | 'recognition'
/** Categories a user may configure for a Property. Mandatory is Organization policy. */
export type ConfigurableNotificationCategory = Exclude<NotificationCategory, 'mandatory'>
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
/**
 * Single source for what a notification may point at, like NOTIFICATION_TYPES:
 * the constructor and the row mapper both derive from this list. They used to
 * keep separate copies, so adding a resource type in one place wrote rows the
 * other then refused to read back.
 */
export const NOTIFICATION_RESOURCE_TYPES = [
  'organization',
  'inbox_item',
  'reply',
  'goal',
  'badge',
  'portal',
  'property',
  'integration',
  /** The recipient's own beta report, by its opaque triage reference (ADR 0059). */
  'beta_feedback_report',
] as const

export type NotificationResourceType = (typeof NOTIFICATION_RESOURCE_TYPES)[number]

// ── In-app notification ─────────────────────────────────────────────

export type Notification = Readonly<{
  id: NotificationId
  userId: UserId
  organizationId: OrganizationId
  /** Null only for Organization-scoped mandatory account/security notices. */
  propertyId: PropertyId | null
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
  /**
   * When the work this notice asked for was finished upstream. Read is not
   * resolved (docs/BETA.md): a resolved row keeps its status, leaves the
   * unread count, and says so to its reader. Null on every notice that never
   * asked for work, and on one whose work is still waiting.
   */
  resolvedAt: Date | null
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
  /** Null only for Organization-scoped mandatory account/security notices. */
  propertyId: PropertyId | null
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
  /**
   * The identifier-only audience descriptor that admitted the recipient, kept
   * so send time can recheck their standing. Opaque here; the application
   * layer parses it. `null` on rows queued before it was stored.
   */
  recipientAudience: unknown
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
  createdAt: Date
  updatedAt: Date
}>

/**
 * When email is held back, and whether urgent mail may go anyway. A person's
 * own setting (ADR 0046 amended 2026-09-23), or a Property override of it.
 * Both times are `HH:mm`, both present or both absent.
 */
export type PersonalDeliveryWindow = Readonly<{
  quietHoursStart: string | null
  quietHoursEnd: string | null
  urgentBypassEnabled: boolean
}>

/**
 * One Property that is deliberately different from the person's own window.
 * The row's existence IS the override, so a row with no times means "never
 * hold email back here".
 */
export type NotificationPropertyDeliveryWindow = PersonalDeliveryWindow &
  Readonly<{
    userId: UserId
    organizationId: OrganizationId
    propertyId: PropertyId
    createdAt: Date
    updatedAt: Date
  }>

/**
 * What a Property with no row of its own inherits for one (category, channel):
 * the person's answer for every Property they have and every Property they are
 * given next.
 */
export type NotificationCategoryDefault = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  category: ConfigurableNotificationCategory
  channel: NotificationChannel
  enabled: boolean
  cadence: NotificationCadence
  createdAt: Date
  updatedAt: Date
}>

export type NotificationUserSettings = PersonalDeliveryWindow &
  Readonly<{
    userId: UserId
    organizationId: OrganizationId
    locale: string
    timezone: string
    createdAt: Date
    updatedAt: Date
  }>

/**
 * Where the notification clock's timezone comes from (ADR 0046 r.3): the
 * user's own choice, else their Organization's representative zone, else UTC.
 */
export type NotificationTimezoneSource = 'user' | 'organization' | 'default'

/**
 * What notifications actually use for one (user, Organization): the language
 * and IANA timezone behind the 08:00 digest and every timestamp, and the
 * person's own quiet hours and urgent bypass. A user who never saved a
 * timezone gets their Organization's, never a silent UTC.
 */
export type EffectiveNotificationSettings = PersonalDeliveryWindow &
  Readonly<{
    locale: string
    timezone: string
    timezoneSource: NotificationTimezoneSource
  }>

// ── Urgent types (Q9 decision) ──────────────────────────────────────

export const URGENT_TYPES: ReadonlySet<NotificationType> = new Set([
  'reply.pending_approval',
  'reply.publish_failed',
  'inbox.escalated',
  'portal.responsibility_needed',
  'property.responsibility_needed',
  'integration.reauthorization_required',
  // The last chance anybody has to stop an irreversible erasure. The other
  // account notices report something already done and stay calm; this one asks
  // for an answer, so it carries the Urgent badge and appears under the Urgent
  // filter. Mandatory mail never waits for quiet hours either way.
  'account.organization_purge_pending',
])

export const isUrgent = (type: NotificationType): boolean => URGENT_TYPES.has(type)
