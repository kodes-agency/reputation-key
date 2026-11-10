// Rights executor for notifications: history, preferences and settings for an
// access export, the Property or Organization purge, and the manual final
// warning. The context owns the reads, allowlists and tenant checks; this
// module only fits its run function to the executor contract.

import type { RightsExecutor } from './rights-executor'

const NOTIFICATION_RIGHTS_EXPORT_PATH = 'notification/notification-rights.json'

export type NotificationRightsRun = Readonly<{
  scope: 'access' | 'property' | 'organization'
  mode: 'report' | 'apply'
  organizationId: string
  propertyId?: string
  batchSize: number
  finalWarning: boolean
  requestRef?: string
}>

export type NotificationRightsOutcome = Readonly<{
  lines: ReadonlyArray<string>
  exportJson?: string
}>

export type NotificationRightsExecutorDeps = Readonly<{
  run: (run: NotificationRightsRun) => Promise<NotificationRightsOutcome>
  /** Apply on an Organization queues final warnings instead of purging. */
  finalWarning: boolean
  /** The tables a purge deletes from, per scope. */
  tables: RightsExecutor['tables']
}>

export function createNotificationRightsExecutor(
  deps: NotificationRightsExecutorDeps,
): RightsExecutor {
  const request = (
    plan: Parameters<RightsExecutor['report']>[0],
    mode: NotificationRightsRun['mode'],
  ): NotificationRightsRun => ({
    scope: plan.scope as NotificationRightsRun['scope'],
    mode,
    organizationId: plan.organizationId,
    ...(plan.scope === 'property' && plan.propertyId
      ? { propertyId: plan.propertyId }
      : {}),
    batchSize: plan.batchSize,
    finalWarning: deps.finalWarning,
    ...(plan.verificationRef ? { requestRef: plan.verificationRef } : {}),
  })
  return Object.freeze({
    name: 'notification',
    scopes: ['access', 'property', 'organization'] as const,
    tables: deps.finalWarning ? {} : deps.tables,
    // A final warning only queues emails and deletes nothing: no entry to replay.
    journalContexts: deps.finalWarning ? ([] as const) : (['notification'] as const),
    // The only refusal apply gives before it touches a row; later failures are
    // runtime errors that the runner reports with the executors already applied.
    async preflight(plan) {
      return deps.finalWarning && plan.scope !== 'organization'
        ? {
            ok: false,
            error: 'Final warnings are sent for an Organization, not a Property',
          }
        : { ok: true }
    },
    async report(plan) {
      return (await deps.run(request(plan, 'report'))).lines
    },
    async exportFiles(plan) {
      const { exportJson } = await deps.run(request(plan, 'report'))
      return exportJson
        ? [
            {
              path: NOTIFICATION_RIGHTS_EXPORT_PATH,
              bytes: Buffer.from(`${exportJson}\n`, 'utf8'),
            },
          ]
        : []
    },
    async apply(plan) {
      try {
        return { ok: true, lines: (await deps.run(request(plan, 'apply'))).lines }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'failed' }
      }
    },
  })
}
