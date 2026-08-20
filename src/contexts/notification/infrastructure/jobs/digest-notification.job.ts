import type { Job } from 'bullmq'
import type { Pool } from 'pg'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
} from '#/shared/domain/ids'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../../application/ports/notification-preference-repository.port'
import type { NotificationRepositoryPort } from '../../application/ports/notification-repository.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import type { Notification, NotificationEmail } from '../../domain/types'
import {
  deliveryTiming,
  isDailyDigestWindow,
} from '../../domain/notification-delivery-policy'
import { getDefaultEnabled } from '../../domain/notification-policy'
import { emailShell, escapeHtml } from '#/shared/email'

export const DIGEST_JOB_NAME = 'digest-notification' as const

type PropertyScope = Readonly<{
  organization_id: string
  property_id: string
  timezone: string
}>

type DigestDeps = Readonly<{
  pool: Pool
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  notifRepo: NotificationRepositoryPort
  userLookup: UserLookupPort
  emailSender: EmailSenderPort
  logger: LoggerPort
  clock: () => Date
  authorizeScope: ScheduledScopeAuthorizer
  enqueueImmediate: (data: {
    notificationEmailId: string
    organizationId: string
    propertyId: string
  }) => Promise<void>
}>

const fetchPropertyScopes = async (pool: Pool): Promise<PropertyScope[]> => {
  const result = await pool.query<PropertyScope>(
    `SELECT organization_id, id::text AS property_id, timezone
       FROM properties
      WHERE deleted_at IS NULL
        AND lifecycle_state = 'active'`,
  )
  return result.rows
}

const groupByUser = (
  entries: readonly NotificationEmail[],
): ReadonlyMap<string, readonly NotificationEmail[]> => {
  const groups = new Map<string, NotificationEmail[]>()
  for (const entry of entries) {
    const key = entry.userId as string
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }
  return groups
}

const digestHtml = (
  entries: readonly NotificationEmail[],
  notifications: ReadonlyMap<string, Notification>,
): string => {
  const items = entries.flatMap((entry) => {
    const notification = notifications.get(entry.notificationId as string)
    return notification
      ? [
          `<p><strong>${escapeHtml(notification.title)}</strong>` +
            (notification.body ? `<br/>${escapeHtml(notification.body)}` : '') +
            '</p>',
        ]
      : []
  })
  return emailShell(items.join('\\n'))
}

const retryAt = (now: Date, retryCount: number): Date =>
  new Date(now.getTime() + Math.min(60 * 60_000, 30_000 * 2 ** retryCount))

async function sendPropertyDigests(
  deps: DigestDeps,
  scope: PropertyScope,
): Promise<void> {
  const now = deps.clock()
  const orgId = organizationId(scope.organization_id)
  const propId = propertyId(scope.property_id)
  const allDue = await deps.emailRepo.findDueByProperty(orgId, propId, 'daily', now)
  const due = isDailyDigestWindow(now, scope.timezone)
    ? allDue
    : allDue.filter((entry) => entry.status === 'delayed')
  if (due.length === 0) return

  for (const [rawUserId, userEntries] of groupByUser(due)) {
    const deliverable: NotificationEmail[] = []
    for (const entry of userEntries) {
      const preference = await deps.preferenceRepo.findForDelivery(
        entry.userId,
        orgId,
        propId,
        entry.category,
        'email',
      )
      if (!(preference?.enabled ?? getDefaultEnabled(entry.category, 'email'))) {
        await deps.emailRepo.markSuppressed(
          notificationEmailId(entry.id as string),
          orgId,
          propId,
          'preference_disabled',
          now,
        )
        continue
      }
      const timing = deliveryTiming({
        now,
        timezone: scope.timezone,
        quietHoursStart: preference?.quietHoursStart ?? null,
        quietHoursEnd: preference?.quietHoursEnd ?? null,
        urgent: false,
        urgentBypassEnabled: false,
      })
      if (timing.kind === 'defer') {
        await deps.emailRepo.markDelayed(
          notificationEmailId(entry.id as string),
          orgId,
          propId,
          timing.until,
          now,
        )
      } else {
        deliverable.push(entry)
      }
    }
    if (deliverable.length === 0) continue

    const recipient = await deps.userLookup.getEmail(
      rawUserId as Parameters<typeof deps.userLookup.getEmail>[0],
    )
    if (!recipient) {
      for (const entry of deliverable) {
        await deps.emailRepo.markSuppressed(
          notificationEmailId(entry.id as string),
          orgId,
          propId,
          'recipient_unavailable',
          now,
        )
      }
      continue
    }

    const ids = deliverable.map((entry) => notificationId(entry.notificationId as string))
    const notifications = await deps.notifRepo.findByIdsForProperty(ids, orgId, propId)
    const present = deliverable.filter((entry) =>
      notifications.has(entry.notificationId as string),
    )
    if (present.length === 0) continue
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: scope.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    const maxRetry = Math.max(...present.map((entry) => entry.retryCount))
    try {
      const outcome = await deps.emailSender.send({
        to: recipient,
        subject: 'Your daily digest — Reputation Key',
        html: digestHtml(present, notifications),
        idempotencyKey: `digest:${scope.property_id}:${rawUserId}:${localDate}`,
      })
      for (const entry of present) {
        const id = notificationEmailId(entry.id as string)
        if (outcome.kind === 'accepted') {
          await deps.emailRepo.markAccepted(
            id,
            orgId,
            propId,
            outcome.providerMessageId,
            outcome.acceptedAt,
          )
        } else {
          await deps.emailRepo.markFailed(
            id,
            orgId,
            propId,
            outcome.classification,
            outcome.classification === 'transient' ? retryAt(now, maxRetry) : null,
            now,
          )
        }
      }
    } catch (error) {
      deps.logger.error({ error }, 'Daily property digest provider call failed')
      for (const entry of present) {
        await deps.emailRepo.markFailed(
          notificationEmailId(entry.id as string),
          orgId,
          propId,
          'transient',
          retryAt(now, maxRetry),
          now,
        )
      }
    }
  }
}

export const createDigestNotificationJobHandler = (deps: DigestDeps) => {
  return async (_job: Job<void>): Promise<void> => {
    const scopes = await fetchPropertyScopes(deps.pool)
    for (const scope of scopes) {
      if (!(await deps.authorizeScope(scope.organization_id, scope.property_id))) continue
      try {
        const now = deps.clock()
        const orgId = organizationId(scope.organization_id)
        const propId = propertyId(scope.property_id)
        const immediate = await deps.emailRepo.findDueByProperty(
          orgId,
          propId,
          'immediate',
          now,
        )
        for (const entry of immediate) {
          await deps.enqueueImmediate({
            notificationEmailId: entry.id as string,
            organizationId: scope.organization_id,
            propertyId: scope.property_id,
          })
        }
        await sendPropertyDigests(deps, scope)
      } catch (error) {
        deps.logger.error({ error }, 'Property notification delivery sweep failed')
      }
    }
  }
}
