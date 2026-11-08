// Feed context — governed cross-context surface for activity and notifications.
import { createServerOnlyFn } from '@tanstack/react-start'
import { queryAuditEvents } from '../audit/read.server'
import { AUDIT_EVENT_RETENTION_RULE } from '../audit/retention.server'
import {
  createNotificationRightsPort,
  runNotificationRights,
  type ManualFinalWarningJob,
  type NotificationRightsRequest,
} from '../rights/executor.server'

export * from './activity-public-api'
export * from './notification-public-api'

export const readAuditEvents = createServerOnlyFn(queryAuditEvents)
export const getAuditEventRetentionRule = createServerOnlyFn(
  () => AUDIT_EVENT_RETENTION_RULE,
)

export type { ManualFinalWarningJob, NotificationRightsRequest }
export const runNotificationRightsRequest = createServerOnlyFn(
  (
    db: Parameters<typeof createNotificationRightsPort>[0],
    enqueue: (job: ManualFinalWarningJob) => Promise<void>,
    request: NotificationRightsRequest,
  ) => runNotificationRights(createNotificationRightsPort(db, enqueue), request),
)
