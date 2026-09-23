// Feed notification surface — which of a recipient's queued digest rows may
// be sent right now.
//
// The daily digest job (`digest-notification.job.ts`) gathers a recipient's
// due rows, or an open batch's frozen members, and passes them through these
// filters before it renders anything: Property authorization, the recipient's
// standing, preference and quiet hours, freshness, and whether the in-app
// notification behind each row can still be read. Every row a filter drops
// for good is settled here, with a visible reason, so a dropped row is never
// mistaken for a lost one; a row dropped only for now (its Property inactive
// or unauthorized, quiet hours) is held or deferred.

import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import {
  notificationEmailId,
  notificationId,
  propertyId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import type { NotificationEmailRepositoryPort } from '../../application/ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../../application/ports/notification-preference-repository.port'
import type { NotificationRepositoryPort } from '../../application/ports/notification-repository.port'
import {
  createRecipientStandingMemo,
  type NotificationRecipientStanding,
} from '../../application/notification-recipient-standing'
import type { NotificationEmail } from '../../domain/notification-types'
import { deliveryTiming } from '../../domain/notification-delivery-policy'
import { getDefaultEnabled } from '../../domain/notification-policy'
import { isStaleQueuedEmail, STALE_EMAIL_REASON } from '../../domain/email-freshness'
import { emailCorrelationId } from '../delivery-correlation'
import type { DigestItem } from './digest-assembly'
import type { NotificationPropertyScopeResolver } from '../repositories/notification-property-scope.repository'

/** A row whose in-app notification can no longer be read, so never sent. */
const NOTIFICATION_UNAVAILABLE_REASON = 'notification_unavailable'

/** What the entry filters need; a subset of the digest job's dependencies. */
export type DigestEntryDeps = Readonly<{
  emailRepo: Pick<NotificationEmailRepositoryPort, 'markSuppressed' | 'markDelayed'>
  preferenceRepo: Pick<NotificationPreferenceRepositoryPort, 'findForDelivery'>
  notifRepo: Pick<NotificationRepositoryPort, 'findByIdsForProperty'>
  logger: LoggerPort
  /** Resolves only an active Property; `null` for any other lifecycle state. */
  resolvePropertyScope: NotificationPropertyScopeResolver
  authorizeScope: ScheduledScopeAuthorizer
  /** The recipient's current membership, access and responsibility. */
  isRecipientEligible: NotificationRecipientStanding
}>

export type RecipientContext = Readonly<{
  orgId: OrganizationId
  userId: UserId
  rawOrgId: string
  now: Date
  timezone: string
  timezoneSource: string
}>

/**
 * Drop rows whose Property is no longer active, or no longer authorized for
 * scheduled delivery. The digest is recipient-scoped but both questions are
 * per Property, so each is asked once per distinct Property, not per row. The
 * rows dropped here are held, not settled — exactly as the urgent path holds
 * a row whose Property it cannot resolve.
 *
 * The due-row query already leaves out rows for inactive Properties; this
 * check is what stops an open batch frozen before its Property was archived.
 */
export async function authorizedEntries(
  deps: DigestEntryDeps,
  rawOrgId: string,
  entries: readonly NotificationEmail[],
): Promise<readonly NotificationEmail[]> {
  const verdicts = new Map<string, boolean>()
  const kept: NotificationEmail[] = []
  for (const entry of entries) {
    const key = entry.propertyId as string
    if (!verdicts.has(key)) {
      const active = (await deps.resolvePropertyScope(rawOrgId, key)) !== null
      verdicts.set(key, active && (await deps.authorizeScope(rawOrgId, key)))
    }
    if (verdicts.get(key)) kept.push(entry)
  }
  return kept
}

/**
 * CONTEXT.md invariant 4, per row: a digest gathers a day of rows, and the
 * recipient may since have left the Organization, lost a Property or been
 * relieved of the responsibility that selected them. Only those rows go; the
 * recipient's other Properties still arrive. One memo serves the recipient's
 * pass, so Property eligibility is asked once per Property and each audience
 * once, however many rows share them.
 */
function recipientStandingFor(
  deps: DigestEntryDeps,
  ctx: RecipientContext,
): (entry: NotificationEmail) => Promise<boolean> {
  const memo = createRecipientStandingMemo()
  return (entry) =>
    deps.isRecipientEligible(
      {
        organizationId: ctx.orgId,
        propertyId: propertyId(entry.propertyId as string),
        userId: ctx.userId,
        audience: entry.recipientAudience,
      },
      memo,
    )
}

/**
 * Standing + preference + quiet-hours filter. Every terminal branch persists
 * AND logs: a suppression nobody can see is indistinguishable from a lost
 * email.
 */
export async function partitionDeliverable(
  deps: DigestEntryDeps,
  ctx: RecipientContext,
  entries: readonly NotificationEmail[],
): Promise<readonly NotificationEmail[]> {
  const deliverable: NotificationEmail[] = []
  const hasStanding = recipientStandingFor(deps, ctx)
  for (const entry of entries) {
    const propId = propertyId(entry.propertyId as string)
    const emailId = notificationEmailId(entry.id as string)
    if (!(await hasStanding(entry))) {
      await deps.emailRepo.markSuppressed(
        emailId,
        ctx.orgId,
        propId,
        'recipient_ineligible',
        ctx.now,
      )
      deps.logger.warn(
        { correlationId: emailCorrelationId(entry.id), reason: 'recipient_ineligible' },
        'Digest entry suppressed',
      )
      continue
    }
    const preference = await deps.preferenceRepo.findForDelivery(
      ctx.userId,
      ctx.orgId,
      propId,
      entry.category,
      'email',
    )
    if (!(preference?.enabled ?? getDefaultEnabled(entry.category, 'email'))) {
      await deps.emailRepo.markSuppressed(
        emailId,
        ctx.orgId,
        propId,
        'preference_disabled',
        ctx.now,
      )
      deps.logger.info(
        { correlationId: emailCorrelationId(entry.id), reason: 'preference_disabled' },
        'Digest entry suppressed',
      )
      continue
    }
    // ADR 0046 r.3: quiet hours on the RECIPIENT's clock, not the property's.
    const timing = deliveryTiming({
      now: ctx.now,
      timezone: ctx.timezone,
      quietHoursStart: preference?.quietHoursStart ?? null,
      quietHoursEnd: preference?.quietHoursEnd ?? null,
      urgent: false,
      urgentBypassEnabled: false,
    })
    if (timing.kind === 'defer') {
      await deps.emailRepo.markDelayed(emailId, ctx.orgId, propId, timing.until, ctx.now)
      deps.logger.info(
        {
          correlationId: emailCorrelationId(entry.id),
          timezone: ctx.timezone,
          timezoneSource: ctx.timezoneSource,
          until: timing.until.toISOString(),
          reason: 'quiet_hours',
        },
        'Digest entry deferred',
      )
      continue
    }
    deliverable.push(entry)
  }
  return deliverable
}

/** Suppress a whole batch with one reason, logging once per row. */
export async function suppressAll(
  deps: DigestEntryDeps,
  ctx: RecipientContext,
  entries: readonly NotificationEmail[],
  reason: string,
): Promise<void> {
  for (const entry of entries) {
    await deps.emailRepo.markSuppressed(
      notificationEmailId(entry.id as string),
      ctx.orgId,
      propertyId(entry.propertyId as string),
      reason,
      ctx.now,
    )
    deps.logger.warn(
      { correlationId: emailCorrelationId(entry.id), reason },
      'Digest entry suppressed',
    )
  }
}

/**
 * Retire rows past their freshness bound — typically queued while email was
 * dark for their scope — so a newly admitted scope never mails its backlog.
 * One log line for the lot: a backlog can be hundreds of rows.
 */
export async function retireStaleEntries(
  deps: DigestEntryDeps,
  ctx: RecipientContext,
  entries: readonly NotificationEmail[],
): Promise<readonly NotificationEmail[]> {
  const stale = entries.filter((entry) => isStaleQueuedEmail(entry, ctx.now))
  for (const entry of stale) {
    await deps.emailRepo.markSuppressed(
      notificationEmailId(entry.id as string),
      ctx.orgId,
      propertyId(entry.propertyId as string),
      STALE_EMAIL_REASON,
      ctx.now,
    )
  }
  if (stale.length > 0) {
    deps.logger.warn(
      { stale: stale.length, reason: STALE_EMAIL_REASON },
      'Digest entries suppressed as too old to send',
    )
  }
  return entries.filter((entry) => !stale.includes(entry))
}

/**
 * Pair each queue row with its in-app notification. Reads are per property
 * because the repository enforces property scope on the notification table.
 *
 * A row whose notification can no longer be read (retention removed it, or it
 * moved scope) can never be sent. It is suppressed as
 * `notification_unavailable` here: skipped instead, it kept its recipient due
 * on every run, and enough of them starved every newer row.
 */
export async function loadItems(
  deps: DigestEntryDeps,
  ctx: RecipientContext,
  entries: readonly NotificationEmail[],
): Promise<readonly DigestItem[]> {
  const byProperty = new Map<string, NotificationEmail[]>()
  for (const entry of entries) {
    const key = entry.propertyId as string
    const bucket = byProperty.get(key)
    if (bucket) bucket.push(entry)
    else byProperty.set(key, [entry])
  }

  const items: DigestItem[] = []
  for (const [rawPropertyId, group] of byProperty) {
    const notifications = await deps.notifRepo.findByIdsForProperty(
      group.map((entry) => notificationId(entry.notificationId as string)),
      ctx.orgId,
      propertyId(rawPropertyId),
    )
    for (const entry of group) {
      const notification = notifications.get(entry.notificationId as string)
      if (notification) items.push({ entry, notification })
    }
  }
  const loaded = new Set(items.map((item) => item.entry.id))
  const unreadable = entries.filter((entry) => !loaded.has(entry.id))
  for (const entry of unreadable) {
    await deps.emailRepo.markSuppressed(
      notificationEmailId(entry.id as string),
      ctx.orgId,
      propertyId(entry.propertyId as string),
      NOTIFICATION_UNAVAILABLE_REASON,
      ctx.now,
    )
  }
  if (unreadable.length > 0) {
    deps.logger.warn(
      { entries: unreadable.length, reason: NOTIFICATION_UNAVAILABLE_REASON },
      'Digest entries suppressed because their notification is gone',
    )
  }
  return items
}
