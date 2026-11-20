// Feed notification surface — public API surface for cross-context consumers.
// Other contexts consume these types to interact with the Feed notification surface.
// Per architecture: contexts must not import from another context's internal layers.

export { NOTIFICATION_RIGHTS_TABLES } from '../domain/notification-rights-tables'

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
  getDefaultMaxRating,
  isPreferenceDisableable,
} from '../domain/notification-policy'
export {
  LOW_RATING_THRESHOLDS,
  type LowRatingThreshold,
} from '../domain/notification-low-ratings'
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
export type { NotificationRenderContext } from '../domain/notification-templates'
export {
  BETA_FEEDBACK_REPORTS_ANCHOR,
  notificationLink,
  notificationRepeatCount,
  renderNotification,
  waitingAge,
} from '../domain/notification-templates'

// ── Category surfaces ─────────────────────────────────────────────────
// Settings exposes only configurable Property categories; the governing list
// drives active filters. The complete retained persistence vocabulary remains
// context-internal.
export {
  classifyNotification,
  NOTIFICATION_SETTINGS_CATEGORIES,
} from '../domain/notification-delivery-policy'

export type { UserLookupPort } from '../notify/notification-db-user-lookup.port.server'
export type { InboxItemLookupPort } from '../notify/inbox-item-lookup.port.server'
export type { NotificationListFilter } from '../feed/notification-list-filter.contracts'
export {
  isStillWaiting,
  type NotificationView,
} from '../feed/notification-view.contracts'
/** Types that stand for work still waiting on their reader, until settled. */
export { isActionableNotificationType } from '../domain/notification-actionable'
export type {
  NotificationFeedCursor,
  NotificationFeedHead,
  NotificationPage,
} from '../feed/notification-page.contracts'
export { isNewerFeedPosition } from '../feed/notification-page.contracts'
