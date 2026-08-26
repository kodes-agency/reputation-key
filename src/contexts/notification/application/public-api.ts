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

export {
  getDefaultCadence,
  getDefaultEnabled,
  isPreferenceDisableable,
} from '../domain/notification-policy'
export { isUrgent, URGENT_TYPES } from '../domain/types'

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
// `NOTIFICATION_CATEGORIES` is the complete retained persistence vocabulary.
// `NOTIFICATION_SETTINGS_CATEGORIES` excludes post-core controls while keeping
// mandatory account/safety policy visible. `GOVERNING_NOTIFICATION_CATEGORIES`
// is its non-empty filter subset. Historical rows from excluded categories
// remain visible through All/Unread and map through the complete vocabulary.
export {
  classifyNotification,
  GOVERNING_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SETTINGS_CATEGORIES,
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
export type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
export type { FeedbackPortalLookupPort } from './ports/feedback-portal-lookup.port'
export type {
  NotificationAudience,
  NotificationAudienceAuthorizationInput,
  NotificationAudienceAuthorizer,
} from './notification-audience'
export type { EmailSenderPort } from './ports/email-sender.port'
export type { InboxItemFacts, InboxItemLookupPort } from './ports/inbox-item-lookup.port'
export type {
  BadgeFacts,
  GoalFacts,
  RecognitionLookupPort,
} from './ports/recognition-lookup.port'

// ── Use-case input re-exports ─────────────────────────────────────────
export type { InsertNotificationInput } from './use-cases/insert-notification'
export {
  NOTIFICATION_LIST_FILTERS,
  type NotificationListFilter,
} from './notification-list-filter'
export type { NotificationPage } from './notification-page'
