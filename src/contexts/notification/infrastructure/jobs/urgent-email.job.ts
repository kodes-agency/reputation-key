// Notification context — urgent email BullMQ job
// Sends individual urgent notification emails immediately.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  JobExecutionEnvelope,
  ScheduledScopeAuthorizer,
} from '#/shared/jobs/delayed-execution-gate'
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
import type { NotificationPropertyScopeResolver } from '../repositories/notification-property-scope.repository'
import { deliveryTiming } from '../../domain/notification-delivery-policy'
import { getDefaultEnabled } from '../../domain/notification-policy'
import { emailShell, escapeHtml } from '#/shared/email'

export const URGENT_EMAIL_JOB_NAME = 'urgent-email' as const

export type UrgentEmailJobData = JobExecutionEnvelope &
  Readonly<{ notificationEmailId: string; propertyId: string }>

type UrgentEmailDeps = Readonly<{
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  notifRepo: NotificationRepositoryPort
  userLookup: UserLookupPort
  emailSender: EmailSenderPort
  resolvePropertyScope: NotificationPropertyScopeResolver
  authorizeScope: ScheduledScopeAuthorizer
  logger: LoggerPort
  clock: () => Date
}>

const retryAt = (now: Date, retryCount: number): Date =>
  new Date(now.getTime() + Math.min(60 * 60_000, 30_000 * 2 ** retryCount))

export const createUrgentEmailJobHandler = (deps: UrgentEmailDeps) => {
  return async (job: Pick<Job<UrgentEmailJobData>, 'data'>): Promise<void> => {
    const rawOrgId = job.data.organizationId
    const rawPropertyId = job.data.propertyId
    const resolved = await deps.resolvePropertyScope(rawOrgId, rawPropertyId)
    if (!resolved) return
    if (!(await deps.authorizeScope(resolved.organizationId, resolved.propertyId))) return

    const orgId = organizationId(resolved.organizationId)
    const propId = propertyId(resolved.propertyId)
    const emailId = notificationEmailId(job.data.notificationEmailId)
    const entry = await deps.emailRepo.findById(emailId, orgId, propId)
    if (!entry || !['pending', 'failed', 'delayed'].includes(entry.status)) return

    const preference = await deps.preferenceRepo.findForDelivery(
      entry.userId,
      orgId,
      propId,
      entry.category,
      'email',
    )
    const enabled = preference?.enabled ?? getDefaultEnabled(entry.category, 'email')
    if (!enabled) {
      await deps.emailRepo.markSuppressed(
        emailId,
        orgId,
        propId,
        'preference_disabled',
        deps.clock(),
      )
      return
    }

    const timing = deliveryTiming({
      now: deps.clock(),
      timezone: resolved.timezone,
      quietHoursStart: preference?.quietHoursStart ?? null,
      quietHoursEnd: preference?.quietHoursEnd ?? null,
      urgent: entry.priority === 'urgent',
      urgentBypassEnabled: preference?.urgentBypassEnabled ?? false,
    })
    if (timing.kind === 'defer') {
      await deps.emailRepo.markDelayed(emailId, orgId, propId, timing.until, deps.clock())
      return
    }

    const notification = await deps.notifRepo.findByIdForProperty(
      notificationId(entry.notificationId as string),
      orgId,
      propId,
    )
    if (!notification) {
      await deps.emailRepo.markSuppressed(
        emailId,
        orgId,
        propId,
        'notification_unavailable',
        deps.clock(),
      )
      return
    }
    const recipient = await deps.userLookup.getEmail(entry.userId)
    if (!recipient) {
      await deps.emailRepo.markSuppressed(
        emailId,
        orgId,
        propId,
        'recipient_unavailable',
        deps.clock(),
      )
      return
    }

    const html = emailShell(
      `<p><strong>${escapeHtml(notification.title)}</strong></p>` +
        (notification.body ? `<p>${escapeHtml(notification.body)}</p>` : ''),
    )
    const attemptedAt = deps.clock()
    try {
      const outcome = await deps.emailSender.send({
        to: recipient,
        subject: `${notification.title} — Reputation Key`,
        html,
        idempotencyKey: entry.idempotencyKey,
      })
      if (outcome.kind === 'accepted') {
        await deps.emailRepo.markAccepted(
          emailId,
          orgId,
          propId,
          outcome.providerMessageId,
          outcome.acceptedAt,
        )
        return
      }

      await deps.emailRepo.markFailed(
        emailId,
        orgId,
        propId,
        outcome.classification,
        outcome.classification === 'transient'
          ? retryAt(attemptedAt, entry.retryCount)
          : null,
        attemptedAt,
      )
      if (outcome.classification === 'transient') {
        throw new Error('Transient email provider rejection')
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Transient email provider rejection'
      )
        throw error
      await deps.emailRepo.markFailed(
        emailId,
        orgId,
        propId,
        'transient',
        retryAt(attemptedAt, entry.retryCount),
        attemptedAt,
      )
      deps.logger.error({ error }, 'Immediate email provider call failed')
      throw error
    }
  }
}
