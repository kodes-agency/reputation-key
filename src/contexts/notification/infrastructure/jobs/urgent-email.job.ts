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
import { renderNotificationEmail, type RenderedEmail } from '../email/render'
import { emailCorrelationId } from '../delivery-correlation'
import {
  assertPreferencesLink,
  mailClassForCategory,
  PREFERENCES_PATH,
  requiresPreferencesLink,
  unsubscribeHeaders,
} from './preferences-link'
import { recipientTimezoneSource, resolveRecipientTimezone } from './recipient-timezone'

export const URGENT_EMAIL_JOB_NAME = 'urgent-email' as const

export type UrgentEmailJobData = JobExecutionEnvelope &
  Readonly<{ notificationEmailId: string }>

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
  oneClickUnsubscribeUrl: (target: Readonly<{ kind: 'email'; id: string }>) => string
}>

const TRANSIENT_REJECTION = 'Transient email provider rejection'

const retryAt = (now: Date, retryCount: number): Date =>
  new Date(now.getTime() + Math.min(60 * 60_000, 30_000 * 2 ** retryCount))

export const createUrgentEmailJobHandler = (deps: UrgentEmailDeps) => {
  /** Suppress + log. Every suppression reason must be visible in logs. */
  const suppress = async (
    ids: Readonly<{ emailId: string; orgId: string; propId: string | null }>,
    reason: string,
  ): Promise<void> => {
    const now = deps.clock()
    await deps.emailRepo.markSuppressed(
      notificationEmailId(ids.emailId),
      organizationId(ids.orgId),
      ids.propId === null ? null : propertyId(ids.propId),
      reason,
      now,
    )
    deps.logger.warn(
      { correlationId: emailCorrelationId(ids.emailId), reason },
      'Urgent notification email suppressed',
    )
  }

  /**
   * Attempt the provider call and record what it said.
   *
   * Throws to hand the job back to the queue for a transient rejection or an
   * outright call failure. Returns normally for accepted mail AND for a
   * permanent rejection — a hard bounce is terminal, and retrying one only
   * damages our sending domain.
   */
  const sendAndRecord = async (
    ids: Readonly<{ emailId: string; orgId: string; propId: string | null }>,
    entry: Readonly<{ idempotencyKey: string; retryCount: number }>,
    recipient: string,
    email: RenderedEmail,
    headers: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const emailId = notificationEmailId(ids.emailId)
    const orgId = organizationId(ids.orgId)
    const propId = ids.propId === null ? null : propertyId(ids.propId)
    const attemptedAt = deps.clock()
    try {
      const outcome = await deps.emailSender.send({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: entry.idempotencyKey,
        headers,
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

  return async (job: Pick<Job<UrgentEmailJobData>, 'data'>): Promise<void> => {
    const orgId = organizationId(job.data.organizationId)
    const emailId = notificationEmailId(job.data.notificationEmailId)
    const resolved =
      job.data.propertyId === undefined
        ? null
        : await deps.resolvePropertyScope(job.data.organizationId, job.data.propertyId)
    if (job.data.propertyId !== undefined && !resolved) return
    if (
      resolved &&
      !(await deps.authorizeScope(resolved.organizationId, resolved.propertyId))
    ) {
      return
    }
    const propId = resolved === null ? null : propertyId(resolved.propertyId)
    const ids = {
      emailId: job.data.notificationEmailId,
      orgId: job.data.organizationId,
      propId: resolved?.propertyId ?? null,
    }
    const entry = await deps.emailRepo.findById(emailId, orgId, propId)
    if (!entry || !['pending', 'failed', 'delayed'].includes(entry.status)) return
    const mandatory = propId === null
    if (
      (mandatory &&
        (entry.category !== 'mandatory' ||
          entry.propertyId !== null ||
          entry.cadence !== 'immediate')) ||
      (!mandatory && entry.category === 'mandatory')
    ) {
      await suppress(ids, 'invalid_delivery_scope')
      return
    }

    const preference = mandatory
      ? null
      : await deps.preferenceRepo.findForDelivery(
          entry.userId,
          orgId,
          propId,
          entry.category,
          'email',
        )
    if (
      !mandatory &&
      !(preference?.enabled ?? getDefaultEnabled(entry.category, 'email'))
    ) {
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
    if (!mandatory) {
      // ADR 0046 r.3: the recipient's clock. Mandatory Organization notices
      // are immediate policy and deliberately bypass preference quiet hours.
      const [settings, orgScope] = await Promise.all([
        deps.preferenceRepo.getUserSettings(entry.userId, orgId),
        deps.resolveOrganizationScope(job.data.organizationId),
      ])
      const sources = {
        userTimezone: settings?.timezone ?? null,
        organizationTimezone: orgScope.timezone,
        propertyTimezone: resolved!.timezone,
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
        await deps.emailRepo.markDelayed(
          emailId,
          orgId,
          propId,
          timing.until,
          deps.clock(),
        )
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
    }

    const notification = mandatory
      ? await deps.notifRepo.findById(notificationId(entry.notificationId), orgId)
      : await deps.notifRepo.findByIdForProperty(
          notificationId(entry.notificationId),
          orgId,
          propId!,
        )
    if (
      !notification ||
      notification.userId !== entry.userId ||
      notification.category !== entry.category ||
      notification.propertyId !== propId
    ) {
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
      ids.propId,
    )
    // ADR 0046 r.7 guard: throws before the provider call for an optional
    // email with no usable preferences link.
    const mailClass = mailClassForCategory(entry.category)
    const preferencesUrl = mandatory
      ? null
      : assertPreferencesLink(mailClass, absoluteUrl(deps.baseUrl, PREFERENCES_PATH))
    const email = renderNotificationEmail({
      rendered: renderNotification(notification.type, notification.payload),
      actionUrl: absoluteUrl(deps.baseUrl, link.path, link.search),
      preferencesUrl,
      priority: entry.priority,
    })
    const oneClickUrl = requiresPreferencesLink(mailClass)
      ? deps.oneClickUnsubscribeUrl({ kind: 'email', id: entry.id as string })
      : ''

    await sendAndRecord(
      ids,
      entry,
      recipient,
      email,
      unsubscribeHeaders(mailClass, oneClickUrl),
    )
  }
}
