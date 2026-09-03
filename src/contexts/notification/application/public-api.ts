// Notification context — public API surface for cross-context consumers.
// Other contexts consume these types to interact with the notification context.
// Per architecture: contexts must not import from another context's internal layers.

// ── Domain type re-exports ────────────────────────────────────────────
export type {
  ConfigurableNotificationCategory,
  Notification,
  NotificationCadence,
  NotificationCategory,
  NotificationChannel,
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
export { isUrgent } from '../domain/types'

// ── Render layer (ADR 0046 r.8) ───────────────────────────────────────
// The ONE source of user-facing notification copy. Every surface — the in-app
// row, the urgent email, the digest line — renders through `renderNotification`
// so copy cannot drift between channels and fixing a sentence fixes it
// everywhere, including rows already in the database.
export type { NotificationPayload } from '../domain/notification-payload'
export {
  formatWaitingAge,
  notificationLink,
  renderNotification,
} from '../domain/notification-templates'

// ── Category surfaces ─────────────────────────────────────────────────
// Settings exposes only configurable Property categories; the governing list
// drives active filters. The complete retained persistence vocabulary remains
// context-internal.
export {
  classifyNotification,
  GOVERNING_NOTIFICATION_CATEGORIES,
  NOTIFICATION_SETTINGS_CATEGORIES,
} from '../domain/notification-delivery-policy'

export type { UserLookupPort } from './ports/user-lookup.port'
export type { InboxItemLookupPort } from './ports/inbox-item-lookup.port'
export type { NotificationListFilter } from './notification-list-filter'
export type { NotificationFeedHead, NotificationPage } from './notification-page'
