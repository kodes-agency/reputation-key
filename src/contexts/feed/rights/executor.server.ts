// Manual rights executor for the notification surface: report, access export,
// final warnings and purge, for one Organization (and optionally one Property).
//
// Everything reaches the database through a port, so the tenant check and the
// field allowlists are exercised without one. A row that belongs to another
// Organization or Property than the request stops the run before any output.

import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import { organizationId as brandOrganization, unbrand } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import type { NotificationPayload } from '../domain/notification-payload'
import { createDisplayNameLookupAdapter } from '../infrastructure/adapters/display-name-lookup.adapter'
import { buildOrganizationPayload } from '../infrastructure/notification-payload-facts'
import { createNotificationDbUserLookupAdapter } from '../infrastructure/adapters/notification-db-user-lookup.adapter'
import { INSERT_NOTIFICATION_JOB_NAME } from '../infrastructure/jobs/insert-notification.job'
import { createNotificationOrganizationEmailStopReader } from '../infrastructure/repositories/notification-organization-email-stop.repository'
import {
  isEmailStopped,
  type OrganizationEmailStop,
} from '../domain/organization-email-stop'
import type { NotificationCategory } from '../domain/notification-types'
import {
  getFormerMemberRemovals,
  getNotificationHistory,
  getNotificationPreferences,
  getNotificationUserSettings,
} from './read.server'
import type { NotificationRightsScope } from './read.server'
import type { RightsRow, ScopedRightsRow } from './fields'
import { purgeNotificationRightsData, type NotificationPurgeCounts } from './purge.server'

export type ManualFinalWarningJob = Readonly<{
  name: typeof INSERT_NOTIFICATION_JOB_NAME
  jobId: string
  data: Readonly<{
    userId: string
    organizationId: string
    propertyId: null
    type: 'account.organization_purge_pending'
    resourceType: 'organization'
    resourceId: string
    eventId: string
    payload: NotificationPayload
    audience:
      | Readonly<{ kind: 'account_admin' }>
      | Readonly<{
          kind: 'affected_organization_user'
          eventId: string
          eventType: 'identity.member.removed'
        }>
  }>
}>

export type NotificationRightsPort = Readonly<{
  history: (scope: NotificationRightsScope) => Promise<readonly ScopedRightsRow[]>
  preferences: (scope: NotificationRightsScope) => Promise<readonly ScopedRightsRow[]>
  userSettings: (scope: NotificationRightsScope) => Promise<readonly ScopedRightsRow[]>
  formerMembers: (organizationId: string) => Promise<readonly ScopedRightsRow[]>
  accountAdmins: (organizationId: string) => Promise<readonly string[]>
  emailStop: (organizationId: string) => Promise<OrganizationEmailStop>
  /** The Organization's name, so the notice can say which one it is about. */
  organizationPayload: (organizationId: string) => Promise<NotificationPayload>
  purge: (
    scope: NotificationRightsScope,
    batchSize: number,
  ) => Promise<NotificationPurgeCounts>
  enqueue: (job: ManualFinalWarningJob) => Promise<void>
}>

export type NotificationRightsRequest = Readonly<{
  scope: 'access' | 'property' | 'organization'
  mode: 'report' | 'apply'
  organizationId: string
  propertyId?: string
  batchSize: number
  /** With apply on an Organization: send the final warnings instead of purging. */
  finalWarning?: boolean
  /** The verified request's reference; it makes the warning jobs repeat-safe. */
  requestRef?: string
}>

export type NotificationRightsResult = Readonly<{
  lines: readonly string[]
  /** The access export, present for report and access runs; never printed. */
  exportJson?: string
}>

const SAMPLE_CATEGORIES: readonly NotificationCategory[] = [
  'mandatory',
  'workflow_collaboration',
]

function scopeOf(request: NotificationRightsRequest): NotificationRightsScope {
  return {
    organizationId: request.organizationId,
    ...(request.scope === 'property' && request.propertyId
      ? { propertyId: request.propertyId }
      : {}),
  }
}

/**
 * Refuse rows that are not the request's tenant. The store already filters;
 * this keeps one mistaken query from reaching an export.
 */
function tenantChecked(
  rows: readonly ScopedRightsRow[],
  request: NotificationRightsRequest,
  { propertyBound }: { propertyBound: boolean },
): readonly RightsRow[] {
  for (const row of rows) {
    if (row.organizationId !== request.organizationId) {
      throw new Error('Notification rights read returned a row of another Organization')
    }
    if (
      propertyBound &&
      request.scope === 'property' &&
      request.propertyId &&
      row.propertyId !== request.propertyId
    ) {
      throw new Error('Notification rights read returned a row of another Property')
    }
  }
  return rows.map((row) => row.fields)
}

/**
 * One job per current AccountAdmin and one per former member. The job has no
 * Property. A former member is admitted by the fact that ended their access,
 * which is why they are found through their removal notice and not a role.
 */
export function buildManualFinalWarningJobs(input: {
  organizationId: string
  requestRef: string
  payload: NotificationPayload
  accountAdmins: readonly string[]
  formerMembers: readonly Readonly<{ userId: string; removalEventId: string }>[]
}): readonly ManualFinalWarningJob[] {
  const eventId = `manual-final-warning:${input.organizationId}:${input.requestRef}`
  const base = {
    organizationId: input.organizationId,
    propertyId: null,
    type: 'account.organization_purge_pending',
    resourceType: 'organization',
    resourceId: input.organizationId,
    eventId,
    payload: input.payload,
  } as const
  const admins = new Set(input.accountAdmins)
  return [
    ...[...admins].map((userId) => ({
      name: INSERT_NOTIFICATION_JOB_NAME as typeof INSERT_NOTIFICATION_JOB_NAME,
      jobId: `${eventId}-${userId}`,
      data: { ...base, userId, audience: { kind: 'account_admin' } as const },
    })),
    ...input.formerMembers
      .filter((member) => !admins.has(member.userId))
      .map((member) => ({
        name: INSERT_NOTIFICATION_JOB_NAME as typeof INSERT_NOTIFICATION_JOB_NAME,
        jobId: `${eventId}-${member.userId}`,
        data: {
          ...base,
          userId: member.userId,
          audience: {
            kind: 'affected_organization_user',
            eventId: member.removalEventId,
            eventType: 'identity.member.removed',
          } as const,
        },
      })),
  ]
}

function formerMemberRecipients(rows: readonly RightsRow[]) {
  return rows.flatMap((row) =>
    typeof row.userId === 'string' && typeof row.eventId === 'string'
      ? [{ userId: row.userId, removalEventId: row.eventId }]
      : [],
  )
}

async function readAll(port: NotificationRightsPort, request: NotificationRightsRequest) {
  const scope = scopeOf(request)
  const [history, preferences, userSettings] = await Promise.all([
    port.history(scope),
    port.preferences(scope),
    port.userSettings(scope),
  ])
  return {
    history: tenantChecked(history, request, { propertyBound: true }),
    preferences: tenantChecked(preferences, request, { propertyBound: true }),
    userSettings: tenantChecked(userSettings, request, { propertyBound: false }),
  }
}

async function report(
  port: NotificationRightsPort,
  request: NotificationRightsRequest,
): Promise<NotificationRightsResult> {
  const data = await readAll(port, request)
  const stop = await port.emailStop(request.organizationId)
  const held = SAMPLE_CATEGORIES.filter((category) => isEmailStopped(stop, category))
  const lines = [
    `notifications: ${data.history.length}`,
    `preferences: ${data.preferences.length}`,
    `user settings: ${data.userSettings.length}`,
    `optional mail: ${stop === 'none' ? 'flowing' : 'held'} (stop=${stop}; mandatory mail ${
      held.includes('mandatory') ? 'held' : 'still sent'
    })`,
  ]
  if (request.scope !== 'property') {
    const [admins, former] = await Promise.all([
      port.accountAdmins(request.organizationId),
      port.formerMembers(request.organizationId),
    ])
    const members = formerMemberRecipients(
      tenantChecked(former, request, { propertyBound: false }),
    )
    lines.push(
      `final warning: ${admins.length} account admins, ${members.length} former members, no Property`,
    )
  }
  return {
    lines,
    exportJson: canonicalizeRfc8785({
      version: 'notification-rights-export/v1',
      notifications: data.history,
      preferences: data.preferences,
      userSettings: data.userSettings,
      excludedRecordClasses: [
        'notification_email_delivery_queue',
        'notification_digest_batches_and_members',
        'notification_source_event_correlation_ids',
      ],
    }),
  }
}

async function sendFinalWarnings(
  port: NotificationRightsPort,
  request: NotificationRightsRequest,
): Promise<NotificationRightsResult> {
  const [admins, former] = await Promise.all([
    port.accountAdmins(request.organizationId),
    port.formerMembers(request.organizationId),
  ])
  // The last notice before an erasure is often read out of context, so it
  // names the Organization the way the automated warning does.
  const jobs = buildManualFinalWarningJobs({
    organizationId: request.organizationId,
    requestRef: request.requestRef ?? 'manual',
    payload: await port.organizationPayload(request.organizationId),
    accountAdmins: admins,
    formerMembers: formerMemberRecipients(
      tenantChecked(former, request, { propertyBound: false }),
    ),
  })
  for (const job of jobs) await port.enqueue(job)
  return { lines: [`final warnings queued: ${jobs.length}`] }
}

async function purge(
  port: NotificationRightsPort,
  request: NotificationRightsRequest,
): Promise<NotificationRightsResult> {
  const counts = await port.purge(scopeOf(request), request.batchSize)
  return {
    lines: Object.entries(counts).map(
      ([table, deleted]) => `${table}: deleted ${deleted}`,
    ),
  }
}

/** The caller has already validated identity and the typed confirmation. */
export async function runNotificationRights(
  port: NotificationRightsPort,
  request: NotificationRightsRequest,
): Promise<NotificationRightsResult> {
  if (request.mode === 'report' || request.scope === 'access') {
    return report(port, request)
  }
  if (request.finalWarning) {
    if (request.scope !== 'organization') {
      throw new Error('Final warnings are sent for an Organization, not a Property')
    }
    return sendFinalWarnings(port, request)
  }
  return purge(port, request)
}

export function createNotificationRightsPort(
  db: Database,
  enqueue: NotificationRightsPort['enqueue'],
): NotificationRightsPort {
  const users = createNotificationDbUserLookupAdapter(db)
  const names = { displayNames: createDisplayNameLookupAdapter(db), logger: getLogger() }
  return {
    history: (scope) => getNotificationHistory(db, scope),
    preferences: (scope) => getNotificationPreferences(db, scope),
    userSettings: (scope) => getNotificationUserSettings(db, scope),
    formerMembers: (organizationId) => getFormerMemberRemovals(db, { organizationId }),
    accountAdmins: async (organizationId) =>
      (await users.findByRole(brandOrganization(organizationId), 'AccountAdmin')).map(
        unbrand,
      ),
    emailStop: createNotificationOrganizationEmailStopReader(db),
    organizationPayload: (organizationId) =>
      buildOrganizationPayload(names, brandOrganization(organizationId)),
    purge: (scope, batchSize) => purgeNotificationRightsData(db, scope, batchSize),
    enqueue,
  }
}
