// Notification context — urgent email BullMQ job
// Sends individual urgent notification emails immediately.
//
// What changed and why (ADR 0046):
//  - r.8: the body is no longer `emailShell('<p><strong>' + notification.title)`.
//    That concatenation shipped whatever string happened to be frozen in the
//    row at insert time — which for pre-template rows is a raw UUID — and it
//    could never be corrected without a backfill. Everything now renders from
//    `type` + `payload` through the ONE renderer, so a copy fix reaches rows
//    already in the database.
//  - r.3: quiet hours run on the RECIPIENT's clock, not the property's. A
//    manager in Sofia looking after a Denver hotel was being woken up on Denver
//    time.
//  - r.7: a non-mandatory email cannot leave the process without a preferences
//    link and the RFC 8058 one-click headers. Enforced by a guard, not by
//    template convention.
//  - r.6: a recipient the provider has already reported as bounced or
//    complained is suppressed before the send, not after another rejection.
//
// The suppression / quiet-hours / retry chain is otherwise unchanged, and every
// terminal branch now emits a structured log line — an invisible suppression is
// indistinguishable from a lost email in support.

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
import { absoluteUrl } from '#/shared/email/urls'
import { maskEmail } from '#/shared/observability/pii'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../../application/ports/notification-preference-repository.port'
import type { NotificationRepositoryPort } from '../../application/ports/notification-repository.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import type { NotificationPropertyScopeResolver } from '../repositories/notification-property-scope.repository'
import type { NotificationOrganizationScopeResolver } from '../repositories/notification-organization-scope.repository'
import { deliveryTiming } from '../../domain/notification-delivery-policy'
import { getDefaultEnabled } from '../../domain/notification-policy'
import { notificationLink, renderNotification } from '../../domain/notification-templates'
import { renderNotificationEmail } from '../email/render'
import { emailCorrelationId } from '../delivery-correlation'
import {
  assertPreferencesLink,
  mailClassForCategory,
  PREFERENCES_PATH,
  unsubscribeHeaders,
} from './preferences-link'
import { recipientTimezoneSource, resolveRecipientTimezone } from './recipient-timezone'

export const URGENT_EMAIL_JOB_NAME = 'urgent-email' as const

export type UrgentEmailJobData = JobExecutionEnvelope &
  Readonly<{ notificationEmailId: string; propertyId: string }>

export type UrgentEmailDeps = Readonly<{
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  notifRepo: NotificationRepositoryPort
  userLookup: UserLookupPort
  emailSender: EmailSenderPort
  resolvePropertyScope: NotificationPropertyScopeResolver
  resolveOrganizationScope: NotificationOrganizationScopeResolver
  authorizeScope: ScheduledScopeAuthorizer
  logger: LoggerPort
  clock: () => Date
  /** `env.BETTER_AUTH_URL`. Injected, never read from env inside the job. */
  baseUrl: string
}>

const TRANSIENT_REJECTION = 'Transient email provider rejection'

const retryAt = (now: Date, retryCount: number): Date =>
  new Date(now.getTime() + Math.min(60 * 60_000, 30_000 * 2 ** retryCount))

export const createUrgentEmailJobHandler = (deps: UrgentEmailDeps) => {
  /** Suppress + log. Every suppression reason must be visible in logs. */
  const suppress = async (
    ids: Readonly<{ emailId: string; orgId: string; propId: string }>,
    reason: string,
  ): Promise<void> => {
    const now = deps.clock()
    await deps.emailRepo.markSuppressed(
      notificationEmailId(ids.emailId),
      organizationId(ids.orgId),
      propertyId(ids.propId),
      reason,
      now,
    )
    deps.logger.warn(
      { correlationId: emailCorrelationId(ids.emailId), reason },
      'Urgent notification email suppressed',
    )
  }

  return async (job: Pick<Job<UrgentEmailJobData>, 'data'>): Promise<void> => {
    const resolved = await deps.resolvePropertyScope(
      job.data.organizationId,
      job.data.propertyId,
    )
    if (!resolved) return
    if (!(await deps.authorizeScope(resolved.organizationId, resolved.propertyId))) return

    const orgId = organizationId(resolved.organizationId)
    const propId = propertyId(resolved.propertyId)
    const emailId = notificationEmailId(job.data.notificationEmailId)
    const ids = {
      emailId: job.data.notificationEmailId,
      orgId: resolved.organizationId,
      propId: resolved.propertyId,
    }
    const entry = await deps.emailRepo.findById(emailId, orgId, propId)
    if (!entry || !['pending', 'failed', 'delayed'].includes(entry.status)) return

    const preference = await deps.preferenceRepo.findForDelivery(
      entry.userId,
      orgId,
      propId,
      entry.category,
      'email',
    )
    if (!(preference?.enabled ?? getDefaultEnabled(entry.category, 'email'))) {
      await suppress(ids, 'preference_disabled')
      return
    }

    // ADR 0046 r.6: never attempt a recipient the provider already rejected
    // terminally. Attempting again earns another bounce against our domain.
    if (await deps.emailRepo.isRecipientSuppressed(entry.userId, orgId)) {
      await suppress(ids, 'recipient_bounced')
      return
    }

    // ADR 0046 r.3: the recipient's clock. Property timezone is the last guess
    // before UTC — an urgent email is scoped to exactly one property, so it is
    // a better guess than UTC when the user never chose a zone.
    const [settings, orgScope] = await Promise.all([
      deps.preferenceRepo.getUserSettings(entry.userId, orgId),
      deps.resolveOrganizationScope(resolved.organizationId),
    ])
    const sources = {
      userTimezone: settings?.timezone ?? null,
      organizationTimezone: orgScope.timezone,
      propertyTimezone: resolved.timezone,
    }
    const timezone = resolveRecipientTimezone(sources)

    const timing = deliveryTiming({
      now: deps.clock(),
      timezone,
      quietHoursStart: preference?.quietHoursStart ?? null,
      quietHoursEnd: preference?.quietHoursEnd ?? null,
      urgent: entry.priority === 'urgent',
      urgentBypassEnabled: preference?.urgentBypassEnabled ?? false,
    })
    if (timing.kind === 'defer') {
      await deps.emailRepo.markDelayed(emailId, orgId, propId, timing.until, deps.clock())
      deps.logger.info(
        {
          correlationId: emailCorrelationId(ids.emailId),
          timezone,
          timezoneSource: recipientTimezoneSource(sources),
          until: timing.until.toISOString(),
          reason: 'quiet_hours',
        },
        'Urgent notification email deferred',
      )
      return
    }

    const notification = await deps.notifRepo.findByIdForProperty(
      notificationId(entry.notificationId as string),
      orgId,
      propId,
    )
    if (!notification) {
      await suppress(ids, 'notification_unavailable')
      return
    }
    const recipient = await deps.userLookup.getEmail(entry.userId)
    if (!recipient) {
      await suppress(ids, 'recipient_unavailable')
      return
    }

    const link = notificationLink(
      notification.resourceType,
      notification.resourceId,
      resolved.propertyId,
    )
    // ADR 0046 r.7 guard: throws before the provider call for an optional
    // email with no usable preferences link.
    const mailClass = mailClassForCategory(entry.category)
    const preferencesUrl = assertPreferencesLink(
      mailClass,
      absoluteUrl(deps.baseUrl, PREFERENCES_PATH),
    )
    const email = renderNotificationEmail({
      rendered: renderNotification(notification.type, notification.payload),
      actionUrl: absoluteUrl(deps.baseUrl, link.path, link.search),
      preferencesUrl,
      priority: entry.priority,
    })

    const attemptedAt = deps.clock()
    try {
      const outcome = await deps.emailSender.send({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: entry.idempotencyKey,
        headers: unsubscribeHeaders(mailClass, preferencesUrl),
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
      deps.logger.warn(
        {
          correlationId: emailCorrelationId(ids.emailId),
          toPrefix: maskEmail(recipient),
          classification: outcome.classification,
          providerCode: outcome.providerCode,
          retryCount: entry.retryCount,
        },
        'Urgent notification email rejected by provider',
      )
      if (outcome.classification === 'transient') throw new Error(TRANSIENT_REJECTION)
    } catch (error) {
      if (error instanceof Error && error.message === TRANSIENT_REJECTION) throw error
      await deps.emailRepo.markFailed(
        emailId,
        orgId,
        propId,
        'transient',
        retryAt(attemptedAt, entry.retryCount),
        attemptedAt,
      )
      deps.logger.error(
        {
          error,
          correlationId: emailCorrelationId(ids.emailId),
          retryCount: entry.retryCount,
        },
        'Immediate email provider call failed',
      )
      throw error
    }
  }
}
