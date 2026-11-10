// Feed context — governed cross-context surface for activity and notifications.
import { createServerOnlyFn } from '@tanstack/react-start'
import { queryAuditEvents } from '../audit/read.server'
import { AUDIT_EVENT_RETENTION_RULE } from '../audit/retention.server'
import {
  copyCategoryDefaultsToPreferences,
  countCategoryDefaultsToCopy,
} from '../preferences/copy-category-defaults.server'
import type {
  createNotificationRightsPort,
  ManualFinalWarningJob,
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
export const copyNotificationCategoryDefaults = createServerOnlyFn(
  copyCategoryDefaultsToPreferences,
)
export const countNotificationCategoryDefaultsToCopy = createServerOnlyFn(
  countCategoryDefaultsToCopy,
)
export const getAuditEventRetentionRule = createServerOnlyFn(
  () => AUDIT_EVENT_RETENTION_RULE,
)

export type { ManualFinalWarningJob, NotificationRightsRequest }
// Loaded on demand so browser bundles and stories never pull in server code.
export const runNotificationRightsRequest = createServerOnlyFn(
  async (
    db: Parameters<typeof createNotificationRightsPort>[0],
    enqueue: (job: ManualFinalWarningJob) => Promise<void>,
    request: NotificationRightsRequest,
  ) => {
    const executor = await import('../rights/executor.server')
    return executor.runNotificationRights(
      executor.createNotificationRightsPort(db, enqueue),
      request,
    )
  },
)

export const loadNotificationRightsReplayers = createServerOnlyFn(async () => {
  const replayer = await import('../rights/replayer.server')
  return replayer.createNotificationRightsReplayers()
})
