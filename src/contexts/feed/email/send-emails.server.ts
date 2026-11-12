// Feed notification surface — immediate email sending.
//
// One immediate email is rendered once. Before its first provider attempt the
// rendered request is stored on the queue row (`provider_request`), and every
// retry sends that stored request verbatim under the row's idempotency key
// until the retry horizon retires the row (`isStaleQueuedEmail`): the provider
// holds a key for 24 hours, and a re-render could change the wording, which it
// refuses under the same key. Before every attempt the recipient is checked
// again — their standing, their address, the provider's suppression list — so
// a frozen request is never sent to someone who should no longer get it.
//
// An attempted row that holds no frozen request began under an earlier
// sender that re-rendered on retry. It is closed rather than sent again.
//
// The same module also queues the work: the job name and capability an
// immediate email travels under, the quiet-hours release, and the hourly sweep
// that re-queues a row whose job never ran or gave up.

import type { Job, JobsOptions } from 'bullmq'
import type { Pool } from 'pg'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  createJobExecutionEnvelope,
  type JobExecutionEnvelope,
  type ScheduledScopeAuthorizer,
} from '#/shared/jobs/delayed-execution-gate'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
  type PropertyId,
} from '#/shared/domain/ids'
import { absoluteUrl } from '#/shared/email/urls'
import { maskEmail } from '#/shared/observability/pii'
import { activePropertyCondition } from '../infrastructure/repositories/active-property'
import type { NotificationEmail } from '../domain/notification-types'
import type { NotificationEmailRepositoryPort } from '../application/ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../application/ports/notification-preference-repository.port'
import type { NotificationRepositoryPort } from '../application/ports/notification-repository.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { EmailSenderPort } from '../application/ports/email-sender.port'
import type { FrozenEmailRequest } from '../domain/notification-types'
import type { NotificationRecipientStanding } from '../application/notification-recipient-standing'
import {
  withStandingItemCount,
  isStillActionable,
  NOT_ACTIONABLE_EMAIL_REASON,
} from '../domain/notification-actionable'
import { type NotificationWorkState } from '../application/ports/notification-work-state.port'
import type { NotificationPropertyScopeResolver } from '../infrastructure/repositories/notification-property-scope.repository'
import type { NotificationOrganizationScopeResolver } from '../infrastructure/repositories/notification-organization-scope.repository'
import {
  deliveryTiming,
  isPropertyAnchoredNotice,
} from '../domain/notification-delivery-policy'
import { isStaleQueuedEmail, STALE_EMAIL_REASON } from '../domain/email-freshness'
import { isEmailCategoryOfNotice } from '../domain/notification-low-ratings'
import {
  notificationLink,
  notificationReplyTo,
  renderNotification,
} from '../domain/notification-templates'
import { renderNotificationEmail } from './render.server'
import { emailCorrelationId } from '../infrastructure/delivery-correlation'
import {
  assertPreferencesLink,
  mailClassForCategory,
  PREFERENCES_PATH,
  preferencesPageUnsubscribeHeaders,
  requiresPreferencesLink,
  unsubscribeHeaders,
} from '../infrastructure/jobs/preferences-link'
import {
  recipientTimezoneSource,
  resolveRecipientTimezone,
} from '../infrastructure/jobs/recipient-timezone'

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

export type SendEmailJobData = JobExecutionEnvelope &
  Readonly<{ notificationEmailId: string }>

export type SendEmailsDeps = Readonly<{
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  notifRepo: NotificationRepositoryPort
  userLookup: UserLookupPort
  emailSender: EmailSenderPort
  resolvePropertyScope: NotificationPropertyScopeResolver
  resolveOrganizationScope: NotificationOrganizationScopeResolver
  authorizeScope: ScheduledScopeAuthorizer
  /** The recipient's current membership, access and responsibility. */
  isRecipientEligible: NotificationRecipientStanding
  /** Whether the work the notice asks for is still waiting. */
  workState: Pick<NotificationWorkState, 'isWaiting'>
  logger: LoggerPort
  clock: () => Date
  /** `env.BETTER_AUTH_URL`. Injected, never read from env inside the job. */
  baseUrl: string
  oneClickUnsubscribeUrl: (target: Readonly<{ kind: 'email'; id: string }>) => string
  /**
   * Re-enqueues this email for the minute its quiet hours end. Without it the
   * hourly sweep is the only release, up to 59 minutes late.
   */
  scheduleRelease?: QuietHoursRelease
}>

/** Enqueue one immediate email to run at `releaseAt`. */
export type QuietHoursRelease = (
  target: Readonly<{
    notificationEmailId: string
    organizationId: string
    propertyId?: string
  }>,
  releaseAt: Date,
) => Promise<void>

const TRANSIENT_REJECTION = 'Transient email provider rejection'

/** Why an attempted row with no frozen request is closed instead of re-sent. */
export const UNFROZEN_ATTEMPT_REASON = 'attempt_not_frozen'

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
  isEmailCategoryOfNotice(notification.type, notification.category, entry.category) &&
  notification.propertyId === propId

export const createSendEmailsHandler = (deps: SendEmailsDeps) => {
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
   * Attempt the provider call with the frozen request and record what it said.
   *
   * Throws to hand the job back to the queue for a transient rejection or an
   * outright call failure. Returns normally for accepted mail AND for a
   * permanent rejection — a hard bounce is terminal, and retrying one only
   * damages our sending domain.
   */
  const sendAndRecord = async (
    ids: EmailDeliveryIds,
    entry: Readonly<{ idempotencyKey: string; retryCount: number }>,
    request: FrozenEmailRequest,
  ): Promise<void> => {
    const emailId = notificationEmailId(ids.emailId)
    const orgId = organizationId(ids.orgId)
    const propId = ids.propId === null ? null : propertyId(ids.propId)
    const attemptedAt = deps.clock()
    try {
      const outcome = await deps.emailSender.send({
        to: request.to,
        subject: request.subject,
        html: request.html,
        text: request.text,
        idempotencyKey: entry.idempotencyKey,
        headers: request.headers,
        ...(request.replyTo === null ? {} : { replyTo: request.replyTo }),
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
          toPrefix: maskEmail(request.to),
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
  const resolveJobScope = async (data: SendEmailJobData) => {
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
   * Best effort: the row is already held, and the hourly sweep still releases
   * anything whose scheduled release was lost, only later.
   */
  const scheduleRelease = async (ids: EmailDeliveryIds, until: Date): Promise<void> => {
    if (!deps.scheduleRelease) return
    try {
      await deps.scheduleRelease(
        {
          notificationEmailId: ids.emailId,
          organizationId: ids.orgId,
          ...(ids.propId === null ? {} : { propertyId: ids.propId }),
        },
        until,
      )
    } catch (error) {
      deps.logger.warn(
        {
          error,
          correlationId: emailCorrelationId(ids.emailId),
          until: until.toISOString(),
        },
        'Quiet-hours release not scheduled; the hourly sweep will release the email',
      )
    }
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
    renders: boolean,
  ): Promise<Readonly<{ deferred: boolean; timezone: string | undefined }>> => {
    const window = await deps.preferenceRepo.resolveDeliveryWindow(
      entry.userId,
      scope.orgId,
      scope.propId,
    )
    // A retry of a frozen request renders nothing; with no quiet window there is
    // nothing to hold it for, so the recipient's settings are not read again.
    if (!renders && (window.quietHoursStart === null || window.quietHoursEnd === null)) {
      return { deferred: false, timezone: undefined }
    }
    const [settings, orgScope] = await Promise.all([
      deps.preferenceRepo.getUserSettings(entry.userId, scope.orgId),
      deps.resolveOrganizationScope(scope.ids.orgId),
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
    await scheduleRelease(scope.ids, timing.until)
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
    // A frozen request names the address it was rendered for. The provider may
    // hold it, so it is neither re-addressed nor mailed to an address the
    // recipient no longer has.
    if (entry.providerRequest !== null && entry.providerRequest.to !== recipient) {
      await suppress(scope.ids, 'recipient_address_changed')
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
      notification.payload,
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
    const headers =
      preferencesUrl !== null && isPropertyAnchoredNotice(notification.type)
        ? preferencesPageUnsubscribeHeaders(preferencesUrl)
        : unsubscribeHeaders(
            mailClass,
            requiresPreferencesLink(mailClass)
              ? deps.oneClickUnsubscribeUrl({ kind: 'email', id: entry.id as string })
              : '',
          )
    return {
      email,
      headers,
      // A notice whose copy asks the reader to answer says where, and the
      // header has to agree with it.
      replyTo: notificationReplyTo(notification.type),
    } as const
  }

  /**
   * The checks every attempt makes, first or retried, before anything is
   * rendered or sent. `false` once the row is suppressed or cannot be sent.
   */
  const mayAttempt = async (
    entry: StoredEmail,
    scope: Awaited<ReturnType<typeof resolveJobScope>> & object,
  ): Promise<boolean> => {
    const { orgId, propId, ids } = scope
    const mandatory = propId === null
    if (!hasValidDeliveryScope(entry, mandatory)) {
      await suppress(ids, 'invalid_delivery_scope')
      return false
    }
    // A backlog queued while email was dark is retired, never flushed, and a
    // row past its retry horizon is closed rather than sent under a key the
    // provider has forgotten.
    if (isStaleQueuedEmail(entry, deps.clock())) {
      await suppress(ids, STALE_EMAIL_REASON)
      return false
    }
    if (entry.attemptedAt !== null && entry.providerRequest === null) {
      deps.logger.error(
        { correlationId: emailCorrelationId(ids.emailId) },
        'Immediate email attempted without a frozen request; closed, not repeated',
      )
      await suppress(ids, UNFROZEN_ATTEMPT_REASON)
      return false
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
        return false
      }
    }
    return true
  }

  /**
   * The freshness checks every attempt makes, first or retried: the notice
   * still exists and still asks for work that is waiting. `null` once the row
   * is suppressed.
   */
  const loadWaitingNotice = async (
    entry: StoredEmail,
    scope: Awaited<ReturnType<typeof resolveJobScope>> & object,
  ) => {
    const { orgId, propId, ids } = scope
    const mandatory = propId === null
    const notification = mandatory
      ? await deps.notifRepo.findById(notificationId(entry.notificationId), orgId)
      : await deps.notifRepo.findByIdForProperty(
          notificationId(entry.notificationId),
          orgId,
          propId,
        )
    if (!notification || !notificationMatchesEntry(notification, entry, propId)) {
      await suppress(ids, 'notification_unavailable')
      return null
    }
    // ADR 0046 (2026-09-24): standing is not freshness, and never was. A
    // notice that asks for work is mailed only while the work is still
    // waiting — unsettled, unread and undismissed.
    if (!isStillActionable(notification)) {
      await suppress(ids, NOT_ACTIONABLE_EMAIL_REASON)
      return null
    }
    // The row may have been written after the fact that settles it, which
    // then found nothing to settle: ask the work itself.
    const work = await deps.workState.isWaiting({
      organizationId: orgId,
      type: notification.type,
      resourceId: notification.resourceId,
      audience: entry.recipientAudience,
      recipient: { userId: notification.userId, propertyId: notification.propertyId },
    })
    if (work === false) {
      await suppress(ids, NOT_ACTIONABLE_EMAIL_REASON)
      return null
    }
    return { notification, work }
  }

  /**
   * First attempt: decide whether the notice is still worth mailing, render it
   * and freeze the request. `null` when the row was suppressed, deferred or
   * can no longer be sent.
   */
  const prepareRequest = async (
    entry: StoredEmail,
    scope: NonNullable<Awaited<ReturnType<typeof resolveJobScope>>>,
  ): Promise<FrozenEmailRequest | null> => {
    const { emailId, orgId, propId, ids } = scope
    const mandatory = propId === null
    let timezone: string | undefined
    if (!mandatory) {
      const quietHours = await deferForQuietHours(scope, entry, true)
      if (quietHours.deferred) return null
      timezone = quietHours.timezone
    }

    const current = await loadWaitingNotice(entry, scope)
    if (current === null) return null
    const { notification, work } = current
    const recipient = await recheckRecipient(scope, entry)
    if (recipient === null) return null

    const { email, headers, replyTo } = composeEmail(
      withStandingItemCount(notification, work),
      entry,
      ids,
      mandatory,
      timezone,
    )
    // The one-click link names only this row, which retention deletes after
    // 90 days; what it stands for is kept before the mail leaves.
    if (
      requiresPreferencesLink(mailClassForCategory(entry.category)) &&
      !isPropertyAnchoredNotice(notification.type)
    ) {
      await deps.emailRepo.recordEmailUnsubscribeScope(emailId, orgId, deps.clock())
    }
    // The stored request is what is sent, whichever worker froze it first.
    return deps.emailRepo.freezeProviderRequest(
      emailId,
      orgId,
      propId,
      {
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers,
        replyTo,
      },
      deps.clock(),
    )
  }

  return async (job: Pick<Job<SendEmailJobData>, 'data'>): Promise<void> => {
    const scope = await resolveJobScope(job.data)
    if (scope === null) return
    const { emailId, orgId, propId, ids } = scope

    const entry = await deps.emailRepo.findById(emailId, orgId, propId)
    if (!entry || !['pending', 'failed', 'delayed'].includes(entry.status)) return
    if (!(await mayAttempt(entry, scope))) return

    if (entry.providerRequest === null) {
      const request = await prepareRequest(entry, scope)
      if (request !== null) await sendAndRecord(ids, entry, request)
      return
    }
    // A retry repeats the frozen request, not the render, but quiet hours still
    // hold it, the notice must still be waiting and the recipient still eligible.
    if (propId !== null && (await deferForQuietHours(scope, entry, false)).deferred)
      return
    if ((await loadWaitingNotice(entry, scope)) === null) return
    if ((await recheckRecipient(scope, entry)) === null) return
    await sendAndRecord(ids, entry, entry.providerRequest)
  }
}

// ── Queueing ───────────────────────────────────────────────────────

export type ImmediateEmailJobQueue = Readonly<{
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>
}>

type ImmediateEmailTarget = Parameters<ImmediateEmailEnqueue>[0]

async function addImmediateEmailJob(
  queue: ImmediateEmailJobQueue,
  target: ImmediateEmailTarget,
  initiatorId: string,
  options: JobsOptions,
): Promise<void> {
  const dispatch = immediateEmailDispatch(target.propertyId)
  await queue.add(
    dispatch.jobName,
    {
      notificationEmailId: target.notificationEmailId,
      ...createJobExecutionEnvelope({
        organizationId: target.organizationId,
        ...(target.propertyId === undefined ? {} : { propertyId: target.propertyId }),
        capability: dispatch.capability,
        initiator: { kind: 'system', id: initiatorId },
        // The delivery logs' identity for the row, so enqueue and send join.
        correlationId: emailCorrelationId(target.notificationEmailId),
      }),
    },
    { ...jobEnqueueOptions(dispatch.jobName), ...options },
  )
}

export const createImmediateEmailEnqueue =
  (queue: ImmediateEmailJobQueue, initiatorId: string): ImmediateEmailEnqueue =>
  (target) =>
    addImmediateEmailJob(queue, target, initiatorId, {})

/**
 * Re-enqueue a quiet-hours hold for the minute the window ends. The job id is
 * the row and its release minute, so a job retried after deferring, or a
 * second deferral to the same end, adds nothing; the handler's sendable-status
 * check makes a run after the hourly sweep already sent it a no-op.
 */
export const createQuietHoursRelease =
  (queue: ImmediateEmailJobQueue, clock: () => Date): QuietHoursRelease =>
  (target, releaseAt) =>
    addImmediateEmailJob(queue, target, 'notification:quiet-hours-release', {
      delay: Math.max(0, releaseAt.getTime() - clock().getTime()),
      jobId: `quiet-release-${target.notificationEmailId}-${releaseAt.getTime()}`,
    })

// ── Immediate-email orphan sweep ───────────────────────────────────
//
// The recovery path for an immediate email whose job never ran or gave up: the
// enqueue after the queue row committed failed (Redis was unavailable), or
// BullMQ spent its attempts on a transient provider failure. The queue row
// survives either way, so the hourly digest run re-enqueues every due
// immediate row it may still send.
//
// Two legs, because two delivery scopes exist. Property-scoped rows are
// authorized per Property. Organization-scoped rows are the mandatory access
// and purge notices ADR 0046 says must always go out; they have no Property,
// so the Property walk never saw them, and they are authorized per
// Organization, under the mandatory action's own capability — the one the
// beta email allowlist does not gate.
//
// A row past its freshness bound — typically queued while its scope was dark
// for email — is suppressed as stale here rather than enqueued, so admitting
// a scope never releases its backlog as a burst.

type PropertyScope = Readonly<{ organization_id: string; property_id: string }>

export type ImmediateEmailEnqueue = (data: {
  notificationEmailId: string
  organizationId: string
  /** Absent for an Organization-scoped mandatory notice. */
  propertyId?: string
}) => Promise<void>

export type ImmediateOrphanSweepDeps = Readonly<{
  pool: Pick<Pool, 'query'>
  emailRepo: Pick<
    NotificationEmailRepositoryPort,
    | 'findDueByProperty'
    | 'findDueOrganizationScopes'
    | 'findDueByOrganization'
    | 'markSuppressed'
  >
  authorizeScope: ScheduledScopeAuthorizer
  /**
   * Authorizes the Organization-scoped leg. Separate from `authorizeScope`
   * because mandatory account/security mail travels under its own action and
   * capability: the beta email allowlist gates ordinary product mail, and a
   * final deletion warning it held back would never be recovered here either.
   */
  authorizeMandatoryScope: ScheduledScopeAuthorizer
  logger: LoggerPort
  enqueueImmediate: ImmediateEmailEnqueue
}>

async function retireStale(
  deps: ImmediateOrphanSweepDeps,
  stale: readonly NotificationEmail[],
  now: Date,
): Promise<void> {
  for (const entry of stale) {
    await deps.emailRepo.markSuppressed(
      entry.id,
      entry.organizationId,
      entry.propertyId,
      STALE_EMAIL_REASON,
      now,
    )
  }
  if (stale.length > 0) {
    deps.logger.warn(
      { stale: stale.length, reason: STALE_EMAIL_REASON },
      'Suppressed immediate notification emails too old to send',
    )
  }
}

async function enqueueAll(
  deps: ImmediateOrphanSweepDeps,
  due: readonly NotificationEmail[],
  scope: Readonly<{ organizationId: string; propertyId?: string }>,
  now: Date,
): Promise<void> {
  const stale = due.filter((entry) => isStaleQueuedEmail(entry, now))
  await retireStale(deps, stale, now)
  const orphans = due.filter((entry) => !stale.includes(entry))
  for (const entry of orphans) {
    await deps.enqueueImmediate({ notificationEmailId: entry.id as string, ...scope })
  }
  if (orphans.length > 0) {
    deps.logger.info(
      { orphans: orphans.length },
      'Re-enqueued immediate notification emails missed by the urgent path',
    )
  }
}

async function sweepPropertyScoped(
  deps: ImmediateOrphanSweepDeps,
  now: Date,
): Promise<void> {
  const scopes = await deps.pool.query<PropertyScope>(
    `SELECT organization_id, id::text AS property_id
       FROM properties
      WHERE ${activePropertyCondition()}`,
  )
  for (const scope of scopes.rows) {
    if (!(await deps.authorizeScope(scope.organization_id, scope.property_id))) continue
    try {
      const orphans = await deps.emailRepo.findDueByProperty(
        organizationId(scope.organization_id),
        propertyId(scope.property_id),
        'immediate',
        now,
      )
      await enqueueAll(
        deps,
        orphans,
        { organizationId: scope.organization_id, propertyId: scope.property_id },
        now,
      )
    } catch (error) {
      deps.logger.error({ error }, 'Immediate email orphan sweep failed for property')
    }
  }
}

async function sweepOrganizationScoped(
  deps: ImmediateOrphanSweepDeps,
  now: Date,
): Promise<void> {
  const organizations = await deps.emailRepo.findDueOrganizationScopes(now)
  for (const orgId of organizations) {
    if (!(await deps.authorizeMandatoryScope(orgId as string))) continue
    try {
      const orphans = await deps.emailRepo.findDueByOrganization(orgId, now)
      await enqueueAll(deps, orphans, { organizationId: orgId as string }, now)
    } catch (error) {
      deps.logger.error(
        { error },
        'Immediate email orphan sweep failed for Organization-scoped mail',
      )
    }
  }
}

export async function sweepImmediateOrphans(
  deps: ImmediateOrphanSweepDeps,
  now: Date,
): Promise<void> {
  await sweepPropertyScoped(deps, now)
  await sweepOrganizationScoped(deps, now)
}
