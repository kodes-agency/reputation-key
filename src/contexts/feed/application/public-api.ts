// Feed context — governed cross-context surface for activity and notifications.
import { createServerOnlyFn } from '@tanstack/react-start'
import { copyAuditLogs, countAuditLogsToCopy } from '../audit/copy-audit-logs.server'
import { queryAuditEvents } from '../audit/read.server'
import { AUDIT_EVENT_RETENTION_RULE } from '../audit/retention.server'
import {
  copyCategoryDefaultsToPreferences,
  countCategoryDefaultsToCopy,
} from '../preferences/copy-category-defaults.server'
import type {
  createNotificationRightsPort,
  NotificationRightsRequest,
} from '../rights/executor.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import type {
  OperationalActionHistoryAccessInput,
  exportOperationalActionHistory,
} from '../audit/operational-action-history-access.server'
import type { OperationalActionHistoryPage } from '../audit/operational-action-history-store.port.server'

// ── Activity ──────────────────────────────────────────────────────────
export type { RecentActivityEntry } from '../domain/activity-types'

export type ActivityPublicApi = Readonly<{
  listOperationalActionHistory(
    input: OperationalActionHistoryAccessInput,
    ctx: AuthContext,
  ): Promise<OperationalActionHistoryPage>
  exportOperationalActionHistory(
    input: OperationalActionHistoryAccessInput,
    ctx: AuthContext,
  ): ReturnType<ReturnType<typeof exportOperationalActionHistory>>
}>

// ── Notifications ─────────────────────────────────────────────────────
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

export const readAuditEvents = createServerOnlyFn(queryAuditEvents)
// Loaded on call: the writer needs node:crypto, which browser bundles cannot import.
export const writeAuditEvent = createServerOnlyFn(
  async (...args: Parameters<typeof import('../audit/write.server').writeAuditEvent>) =>
    (await import('../audit/write.server')).writeAuditEvent(...args),
)
export const copyAuditLogsToAuditEvents = createServerOnlyFn(copyAuditLogs)
export const countAuditLogsToCopyAsEvents = createServerOnlyFn(countAuditLogsToCopy)
export const copyNotificationCategoryDefaults = createServerOnlyFn(
  copyCategoryDefaultsToPreferences,
)
export const countNotificationCategoryDefaultsToCopy = createServerOnlyFn(
  countCategoryDefaultsToCopy,
)
export const getAuditEventRetentionRule = createServerOnlyFn(
  () => AUDIT_EVENT_RETENTION_RULE,
)

export type { NotificationRightsRequest }
// Loaded on demand so browser bundles and stories never pull in server code.
export const runNotificationRightsRequest = createServerOnlyFn(
  async (
    db: Parameters<typeof createNotificationRightsPort>[0],
    noticeWriter: Parameters<typeof createNotificationRightsPort>[1],
    request: NotificationRightsRequest,
  ) => {
    const executor = await import('../rights/executor.server')
    return executor.runNotificationRights(
      executor.createNotificationRightsPort(db, noticeWriter),
      request,
    )
  },
)

export const loadNotificationRightsReplayers = createServerOnlyFn(async () => {
  const replayer = await import('../rights/replayer.server')
  return replayer.createNotificationRightsReplayers()
})
