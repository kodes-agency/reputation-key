// Feed context — governed cross-context surface for activity and notifications.
import { createServerOnlyFn } from '@tanstack/react-start'
import { copyAuditLogs, countAuditLogsToCopy } from '../audit/copy-audit-logs.server'
import {
  copyOperationalHistory,
  countOperationalHistoryToCopy,
} from '../audit/copy-operational-history.server'
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

export * from './activity-public-api'
export * from './notification-public-api'

export const readAuditEvents = createServerOnlyFn(queryAuditEvents)
// Loaded on call: the writer needs node:crypto, which browser bundles cannot import.
export const writeAuditEvent = createServerOnlyFn(
  async (...args: Parameters<typeof import('../audit/write.server').writeAuditEvent>) =>
    (await import('../audit/write.server')).writeAuditEvent(...args),
)
export const copyAuditLogsToAuditEvents = createServerOnlyFn(copyAuditLogs)
export const countAuditLogsToCopyAsEvents = createServerOnlyFn(countAuditLogsToCopy)
export const copyOperationalHistoryToAuditEvents =
  createServerOnlyFn(copyOperationalHistory)
export const countOperationalHistoryToCopyAsEvents = createServerOnlyFn(
  countOperationalHistoryToCopy,
)
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
