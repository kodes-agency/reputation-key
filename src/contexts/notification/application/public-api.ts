// Notification context — public API surface for cross-context consumers.
// Other contexts consume these types to interact with the notification context.
// Per architecture: contexts must not import from another context's internal layers.

// ── Domain type re-exports ────────────────────────────────────────────
export type {
  DeliveryErrorClass,
  EmailQueueStatus,
  Notification,
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
  NotificationEmail,
  NotificationPreference,
  NotificationPriority,
  NotificationResourceType,
  NotificationStatus,
  NotificationType,
  NotificationUserSettings,
} from '../domain/types'

export { getDefaultEnabled } from '../domain/notification-policy'
export { isUrgent, URGENT_TYPES, NOTIFICATION_TYPES } from '../domain/types'

// ── Render layer (ADR 0046 r.8) ───────────────────────────────────────
// The ONE source of user-facing notification copy. Every surface — the in-app
// row, the urgent email, the digest line — renders through `renderNotification`
// so copy cannot drift between channels and fixing a sentence fixes it
// everywhere, including rows already in the database.
export type {
  NotificationActorRole,
  NotificationPayload,
  NotificationPlatform,
  NotificationRating,
  NotificationTargetKind,
} from '../domain/notification-payload'
export {
  isEmptyNotificationPayload,
  parseNotificationPayload,
} from '../domain/notification-payload'

export type {
  NotificationLink,
  RenderedNotification,
} from '../domain/notification-templates'
export {
  formatWaitingAge,
  notificationLink,
  renderNotification,
} from '../domain/notification-templates'

// ── Category surfaces ─────────────────────────────────────────────────
// `NOTIFICATION_CATEGORIES` = all five, for the settings page (ADR 0046 keeps
// `mandatory` reserved for account/security/legal).
// `GOVERNING_NOTIFICATION_CATEGORIES` = only those governing >= 1 type, derived
// not hand-listed. Filters MUST use this one: a `mandatory` filter can only
// ever return an empty list today.
export {
  classifyNotification,
  GOVERNING_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
} from '../domain/notification-delivery-policy'

// ── Constructor re-exports ────────────────────────────────────────────
export type { CreateNotificationInput } from '../domain/constructors'
export type { CreateNotificationEmailInput } from '../domain/constructors-email'
export type { CreateNotificationPreferenceInput } from '../domain/constructors-preference'

// ── Error re-exports ──────────────────────────────────────────────────
export type { NotificationError } from '../domain/errors'
export { notificationError, isNotificationError } from '../domain/errors'

// ── Port type re-exports ──────────────────────────────────────────────
export type { NotificationRepositoryPort } from './ports/notification-repository.port'
export type { NotificationEmailRepositoryPort } from './ports/notification-email-repository.port'
export type { NotificationPreferenceRepositoryPort } from './ports/notification-preference-repository.port'
export type { UserLookupPort } from './ports/user-lookup.port'
export type { EmailSenderPort } from './ports/email-sender.port'
export type {
  InboxItemFacts,
  InboxItemLookupPort,
} from './ports/inbox-item-lookup.port'
export type {
  BadgeFacts,
  GoalFacts,
  RecognitionLookupPort,
} from './ports/recognition-lookup.port'

// ── Use-case input re-exports ─────────────────────────────────────────
export type { InsertNotificationInput } from './use-cases/insert-notification'
