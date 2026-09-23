// Feed notification surface — public API surface for cross-context consumers.
// Other contexts consume these types to interact with the Feed notification surface.
// Per architecture: contexts must not import from another context's internal layers.

// ── Domain type re-exports ────────────────────────────────────────────
export type {
  ConfigurableNotificationCategory,
  EffectiveNotificationSettings,
  Notification,
  NotificationCadence,
  NotificationCategory,
  NotificationCategoryDefault,
  NotificationChannel,
  NotificationPreference,
  NotificationPropertyDeliveryWindow,
  NotificationPriority,
  NotificationResourceType,
  NotificationStatus,
  NotificationTimezoneSource,
  NotificationType,
  NotificationUserSettings,
  PersonalDeliveryWindow,
} from '../domain/notification-types'

export {
  getDefaultCadence,
  getDefaultEnabled,
  isPreferenceDisableable,
} from '../domain/notification-policy'
export {
  effectiveEmailCadence,
  offeredEmailCadences,
} from '../domain/notification-cadence'
export {
  resolveCategoryPreference,
  type CategoryPreferenceValues,
} from '../domain/notification-preference-resolution'

// ── Render layer (ADR 0046 r.8) ───────────────────────────────────────
// The ONE source of user-facing notification copy. Every surface — the in-app
// row, the urgent email, the digest line — renders through `renderNotification`
// so copy cannot drift between channels and fixing a sentence fixes it
// everywhere, including rows already in the database.
export type { NotificationPayload } from '../domain/notification-payload'
export {
  BETA_FEEDBACK_REPORTS_ANCHOR,
  notificationLink,
  renderNotification,
  waitingAge,
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

export type { UserLookupPort } from './ports/notification-user-lookup.port'
export type { InboxItemLookupPort } from './ports/notification-inbox-item-lookup.port'
export type { NotificationListFilter } from './notification-list-filter'
export type { NotificationView } from './notification-view'
export type {
  NotificationFeedCursor,
  NotificationFeedHead,
  NotificationPage,
} from './notification-page'
export { isNewerFeedPosition } from './notification-page'
