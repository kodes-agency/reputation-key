// Feed notification surface — urgent email BullMQ job
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
  type PropertyId,
} from '#/shared/domain/ids'
import { absoluteUrl } from '#/shared/email/urls'
import { maskEmail } from '#/shared/observability/pii'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../../application/ports/notification-preference-repository.port'
import type { NotificationRepositoryPort } from '../../application/ports/notification-repository.port'
import type { UserLookupPort } from '../../application/ports/notification-user-lookup.port'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import type { NotificationRecipientStanding } from '../../application/notification-recipient-standing'
import type { NotificationPropertyScopeResolver } from '../repositories/notification-property-scope.repository'
import type { NotificationOrganizationScopeResolver } from '../repositories/notification-organization-scope.repository'
import { deliveryTiming } from '../../domain/notification-delivery-policy'
import { isStaleQueuedEmail, STALE_EMAIL_REASON } from '../../domain/email-freshness'
import {
  isStillActionable,
  NOT_ACTIONABLE_EMAIL_REASON,
} from '../../domain/notification-settlement'
import {
  isEmailStopped,
  ORGANIZATION_CLOSING_REASON,
} from '../../domain/organization-email-stop'
import type { NotificationOrganizationEmailStopPort } from '../../application/ports/notification-organization-email-stop.port'
import {
  notificationLink,
  notificationReplyTo,
  renderNotification,
} from '../../domain/notification-templates'
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

/**
 * The same processor under its own name and capability, for the immediate mail
 * of an Organization-scoped mandatory notice.
 *
 * Two names rather than one, because the delayed execution gate decides a
 * capability per job name: `notification.send_email` is allowlisted per
 * Organization for the beta, and a final deletion warning held back by that
 * allowlist is worse than an extra email (ADR 0046). Everything after the gate
 * is identical — the stored row still has to be mandatory, Organization-scoped
 * and immediate, or the handler suppresses it as an invalid delivery scope.
 */
export const MANDATORY_EMAIL_JOB_NAME = 'mandatory-email' as const

/**
 * The job name and capability one immediate email travels under, decided
 * together so the envelope and the catalogue cannot drift apart (the gate
 * refuses a mismatch as `capability_mismatch`).
 *
 * The absence of a Property IS the mandatory scope: `hasValidDeliveryScope`
 * and the `notification_emails` scope CHECK both say so, and a row that
 * disagrees is suppressed rather than sent.
 */
export const immediateEmailDispatch = (propertyId: string | undefined) =>
  propertyId === undefined
    ? ({
        jobName: MANDATORY_EMAIL_JOB_NAME,
        capability: 'notification.send_mandatory_email',
      } as const)
    : ({ jobName: URGENT_EMAIL_JOB_NAME, capability: 'notification.send_email' } as const)

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
  /** How far the Organization's lifecycle stops its email. */
  organizationEmailStop: NotificationOrganizationEmailStopPort
  /** The recipient's current membership, access and responsibility. */
  isRecipientEligible: NotificationRecipientStanding
  logger: LoggerPort
  clock: () => Date
  /** `env.BETTER_AUTH_URL`. Injected, never read from env inside the job. */
  baseUrl: string
  oneClickUnsubscribeUrl: (target: Readonly<{ kind: 'email'; id: string }>) => string
}>

const TRANSIENT_REJECTION = 'Transient email provider rejection'

const retryAt = (now: Date, retryCount: number): Date =>
  new Date(now.getTime() + Math.min(60 * 60_000, 30_000 * 2 ** retryCount))

/** Raw identifiers for logging/suppression, before branding. */
type EmailDeliveryIds = Readonly<{
  emailId: string
  orgId: string
  propId: string | null
}>

type StoredEmail = NonNullable<
  Awaited<ReturnType<NotificationEmailRepositoryPort['findById']>>
>
type StoredNotification = NonNullable<
  Awaited<ReturnType<NotificationRepositoryPort['findById']>>
>

/**
 * An Organization-wide row is mandatory-only and immediate; a Property-scoped
 * row is anything but mandatory. Either mismatch means the job and the stored
 * row disagree about the delivery scope.
 */
const hasValidDeliveryScope = (entry: StoredEmail, mandatory: boolean): boolean =>
  mandatory
    ? entry.category === 'mandatory' &&
      entry.propertyId === null &&
      entry.cadence === 'immediate'
    : entry.category !== 'mandatory'

const notificationMatchesEntry = (
  notification: StoredNotification,
  entry: StoredEmail,
  propId: PropertyId | null,
): boolean =>
  notification.userId === entry.userId &&
  notification.category === entry.category &&
  notification.propertyId === propId

export const createUrgentEmailJobHandler = (deps: UrgentEmailDeps) => {
  /** Suppress + log. Every suppression reason must be visible in logs. */
  const suppress = async (ids: EmailDeliveryIds, reason: string): Promise<void> => {
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
    ids: EmailDeliveryIds,
    entry: Readonly<{ idempotencyKey: string; retryCount: number }>,
    recipient: string,
    email: RenderedEmail,
    headers: Readonly<Record<string, string>>,
    replyTo: string | null,
  ): Promise<void> => {
    const emailId = notificationEmailId(ids.emailId)
    const orgId = organizationId(ids.orgId)
    const propId = ids.propId === null ? null : propertyId(ids.propId)
    const attemptedAt = deps.clock()
    // Before the call: a worker that dies mid-call must still leave the start
    // of the provider's idempotency window behind (`isStaleQueuedEmail`).
    await deps.emailRepo.markAttemptStarted(emailId, orgId, propId, attemptedAt)
    try {
      const outcome = await deps.emailSender.send({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: entry.idempotencyKey,
        headers,
        ...(replyTo === null ? {} : { replyTo }),
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

  /**
   * Resolve the job's Property scope and re-check current authority. `null`
   * means the job must be dropped without touching the stored row.
   */
  const resolveJobScope = async (data: UrgentEmailJobData) => {
    const resolved =
      data.propertyId === undefined
        ? null
        : await deps.resolvePropertyScope(data.organizationId, data.propertyId)
    if (data.propertyId !== undefined && !resolved) return null
    if (
      resolved &&
      !(await deps.authorizeScope(resolved.organizationId, resolved.propertyId))
    ) {
      return null
    }
    return {
      orgId: organizationId(data.organizationId),
      emailId: notificationEmailId(data.notificationEmailId),
      propId: resolved === null ? null : propertyId(resolved.propertyId),
      propertyTimezone: resolved?.timezone ?? null,
      ids: {
        emailId: data.notificationEmailId,
        orgId: data.organizationId,
        propId: resolved?.propertyId ?? null,
      } satisfies EmailDeliveryIds,
    } as const
  }

  /**
   * ADR 0046 r.3: quiet hours run on the RECIPIENT's clock, and (amended
   * 2026-09-23) they are the recipient's own window, not the Property
   * preference row's — unless this Property overrides it, which the resolver
   * applies. Property timezone is the last guess before UTC: an urgent email
   * is scoped to exactly one property, so it is a better guess than UTC when
   * the user never chose a zone. Mandatory Organization notices never reach
   * here: they are immediate policy and deliberately bypass quiet hours.
   *
   * Returns true when the send was deferred and the job is finished.
   */
  const deferForQuietHours = async (
    scope: Readonly<{
      orgId: ReturnType<typeof organizationId>
      emailId: ReturnType<typeof notificationEmailId>
      propId: PropertyId | null
      propertyTimezone: string | null
      ids: EmailDeliveryIds
    }>,
    entry: StoredEmail,
  ): Promise<Readonly<{ deferred: boolean; timezone: string }>> => {
    const [settings, orgScope, window] = await Promise.all([
      deps.preferenceRepo.getUserSettings(entry.userId, scope.orgId),
      deps.resolveOrganizationScope(scope.ids.orgId),
      deps.preferenceRepo.resolveDeliveryWindow(entry.userId, scope.orgId, scope.propId),
    ])
    const sources = {
      userTimezone: settings?.timezone ?? null,
      organizationTimezone: orgScope.timezone,
      propertyTimezone: scope.propertyTimezone,
    }
    const timezone = resolveRecipientTimezone(sources)
    const timing = deliveryTiming({
      now: deps.clock(),
      timezone,
      quietHoursStart: window.quietHoursStart,
      quietHoursEnd: window.quietHoursEnd,
      urgent: entry.priority === 'urgent',
      urgentBypassEnabled: window.urgentBypassEnabled,
    })
    if (timing.kind !== 'defer') return { deferred: false, timezone }
    await deps.emailRepo.markDelayed(
      scope.emailId,
      scope.orgId,
      scope.propId,
      timing.until,
      deps.clock(),
    )
    deps.logger.info(
      {
        correlationId: emailCorrelationId(scope.ids.emailId),
        timezone,
        timezoneSource: recipientTimezoneSource(sources),
        until: timing.until.toISOString(),
        reason: 'quiet_hours',
      },
      'Urgent notification email deferred',
    )
    return { deferred: true, timezone }
  }

  /**
   * The recipient checks made immediately before the provider effect. Returns
   * the address to mail, or `null` once the row is suppressed with its reason.
   */
  const recheckRecipient = async (
    scope: Readonly<{
      orgId: ReturnType<typeof organizationId>
      propId: PropertyId | null
      ids: EmailDeliveryIds
    }>,
    entry: StoredEmail,
  ): Promise<string | null> => {
    // CONTEXT.md invariant 4. Quiet hours and retries can hold a row for
    // hours; a recipient removed or moved off the Property since must not get
    // it. Organization mandatory mail is exempt: an access-removed notice is
    // addressed to someone who is no longer a member.
    if (
      scope.propId !== null &&
      !(await deps.isRecipientEligible({
        organizationId: scope.orgId,
        propertyId: scope.propId,
        userId: entry.userId,
        audience: entry.recipientAudience,
      }))
    ) {
      await suppress(scope.ids, 'recipient_ineligible')
      return null
    }
    const recipient = await deps.userLookup.getEmail(entry.userId)
    if (!recipient) {
      await suppress(scope.ids, 'recipient_unavailable')
      return null
    }
    // ADR 0046 r.6: never attempt an address the provider refused for good,
    // from any Organization. Attempting again earns another bounce or
    // complaint against our domain.
    if (await deps.emailRepo.isAddressSuppressed(recipient)) {
      await suppress(scope.ids, 'recipient_bounced')
      return null
    }
    return recipient
  }

  /**
   * ADR 0046 r.7 guard: `assertPreferencesLink` throws before the provider
   * call for an optional email with no usable preferences link.
   */
  const composeEmail = (
    notification: StoredNotification,
    entry: StoredEmail,
    ids: EmailDeliveryIds,
    mandatory: boolean,
    timezone: string | undefined,
  ) => {
    const link = notificationLink(
      notification.resourceType,
      notification.resourceId,
      ids.propId,
      notification.type,
    )
    const mailClass = mailClassForCategory(entry.category)
    // Optional mail is always about one Property, and the settings route opens
    // the Property `?propertyId=` names while the reader can still see it — so
    // "Manage preferences" lands on this email's Property, not the first one.
    const preferencesUrl = mandatory
      ? null
      : assertPreferencesLink(
          mailClass,
          absoluteUrl(
            deps.baseUrl,
            PREFERENCES_PATH,
            ids.propId === null ? undefined : { propertyId: ids.propId },
          ),
        )
    const email = renderNotificationEmail({
      // The recipient's own zone, already resolved for quiet hours, so a
      // Response Target reminder can say the target time on their clock.
      // Mandatory account mail never carries one and never resolves a zone.
      rendered: renderNotification(
        notification.type,
        notification.payload,
        timezone === undefined ? undefined : { timeZone: timezone },
      ),
      actionUrl: absoluteUrl(deps.baseUrl, link.path, link.search),
      preferencesUrl,
      priority: entry.priority,
    })
    const oneClickUrl = requiresPreferencesLink(mailClass)
      ? deps.oneClickUnsubscribeUrl({ kind: 'email', id: entry.id as string })
      : ''
    return {
      email,
      headers: unsubscribeHeaders(mailClass, oneClickUrl),
      // A notice whose copy asks the reader to answer says where, and the
      // header has to agree with it.
      replyTo: notificationReplyTo(notification.type),
    } as const
  }

  return async (job: Pick<Job<UrgentEmailJobData>, 'data'>): Promise<void> => {
    const scope = await resolveJobScope(job.data)
    if (scope === null) return
    const { emailId, orgId, propId, ids } = scope

    const entry = await deps.emailRepo.findById(emailId, orgId, propId)
    if (!entry || !['pending', 'failed', 'delayed'].includes(entry.status)) return
    const mandatory = propId === null
    if (!hasValidDeliveryScope(entry, mandatory)) {
      await suppress(ids, 'invalid_delivery_scope')
      return
    }
    // A closure request stops optional mail at once; mandatory notices go
    // out until the irreversible boundary.
    if (isEmailStopped(await deps.organizationEmailStop(ids.orgId), entry.category)) {
      await suppress(ids, ORGANIZATION_CLOSING_REASON)
      return
    }
    // A backlog queued while email was dark is retired, never flushed.
    if (isStaleQueuedEmail(entry, deps.clock())) {
      await suppress(ids, STALE_EMAIL_REASON)
      return
    }

    if (!mandatory) {
      const preference = await deps.preferenceRepo.resolveForDelivery(
        entry.userId,
        orgId,
        propId,
        entry.category,
        'email',
      )
      if (!preference.enabled) {
        await suppress(ids, 'preference_disabled')
        return
      }
    }

    let timezone: string | undefined
    if (!mandatory) {
      const quietHours = await deferForQuietHours(scope, entry)
      if (quietHours.deferred) return
      timezone = quietHours.timezone
    }

    const notification = mandatory
      ? await deps.notifRepo.findById(notificationId(entry.notificationId), orgId)
      : await deps.notifRepo.findByIdForProperty(
          notificationId(entry.notificationId),
          orgId,
          propId,
        )
    if (!notification || !notificationMatchesEntry(notification, entry, propId)) {
      await suppress(ids, 'notification_unavailable')
      return
    }
    // ADR 0046 (2026-09-24): standing is not freshness, and never was. A
    // notice that asks for work is mailed only while the work is still
    // waiting — unsettled, unread and undismissed.
    if (!isStillActionable(notification)) {
      await suppress(ids, NOT_ACTIONABLE_EMAIL_REASON)
      return
    }
    const recipient = await recheckRecipient(scope, entry)
    if (recipient === null) return

    const { email, headers, replyTo } = composeEmail(
      notification,
      entry,
      ids,
      mandatory,
      timezone,
    )
    // The one-click link names only this row, which retention deletes after
    // 90 days; what it stands for is kept before the mail leaves.
    if (requiresPreferencesLink(mailClassForCategory(entry.category))) {
      await deps.emailRepo.recordEmailUnsubscribeScope(emailId, orgId, deps.clock())
    }
    await sendAndRecord(ids, entry, recipient, email, headers, replyTo)
  }
}
