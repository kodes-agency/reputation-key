// Notification context — daily digest + delivery sweep.
//
// This job was restructured, not patched. It used to iterate PROPERTIES and use
// the PROPERTY timezone, so a manager responsible for three hotels received
// three separate digests, each at that hotel's local 08:00. ADR 0046 r.3/r.4
// require ONE digest per USER, in the USER's IANA timezone with an organization
// fallback, grouped by property inside a single email.
//
// It now iterates RECIPIENTS. `notification_user_settings.timezone` has been
// written by `updateNotificationUserSettingsFn` since migration 0026 and read
// by nothing until here.
//
// Also gone: the hand-rolled `emailShell(items.join('\\n'))`, whose separator
// was a literal two-character backslash-n — so every digest was one unbroken
// run of paragraphs with a stray `\n` between them. HTML is now produced only
// by `renderDigestEmail`.
//
// Note the dispatch axis: "daily digest" is a CADENCE (`cadence === 'daily'`),
// never a category. This job has always selected on cadence and continues to.
//
// The `immediate`-cadence orphan sweep is unchanged in spirit: it stays
// property-scoped because an urgent email IS property-scoped, and it is the
// recovery path for an enqueue that failed at insert time.

import type { Job } from 'bullmq'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import {
  notificationEmailId,
  notificationDigestBatchId,
  notificationId,
  organizationId,
  propertyId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import { absoluteUrl } from '#/shared/email/urls'
import { maskEmail } from '#/shared/observability/pii'
import type {
  NotificationDigestBatch,
  NotificationEmailRecipient,
  NotificationEmailRepositoryPort,
} from '../../application/ports/notification-email-repository.port'
import type { NotificationPreferenceRepositoryPort } from '../../application/ports/notification-preference-repository.port'
import type { NotificationRepositoryPort } from '../../application/ports/notification-repository.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import type { NotificationOrganizationScopeResolver } from '../repositories/notification-organization-scope.repository'
import type { NotificationEmail } from '../../domain/types'
import {
  deliveryTiming,
  isDailyDigestWindow,
} from '../../domain/notification-delivery-policy'
import { getDefaultEnabled } from '../../domain/notification-policy'
import { renderDigestEmail } from '../email/render'
import { emailCorrelationId } from '../delivery-correlation'
import {
  digestBatchIdempotencyKey,
  digestMemberSet,
  digestProviderRequest,
  groupItemsByProperty,
  type DigestItem,
} from './digest-assembly'
import {
  assertPreferencesLink,
  PREFERENCES_PATH,
  unsubscribeHeaders,
} from './preferences-link'
import {
  localDateKey,
  localDateLabel,
  recipientTimezoneSource,
  resolveRecipientTimezone,
} from './recipient-timezone'

export const DIGEST_JOB_NAME = 'digest-notification' as const

type PropertyScope = Readonly<{ organization_id: string; property_id: string }>

export type DigestDeps = Readonly<{
  pool: Pool
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  notifRepo: NotificationRepositoryPort
  userLookup: UserLookupPort
  emailSender: EmailSenderPort
  resolveOrganizationScope: NotificationOrganizationScopeResolver
  logger: LoggerPort
  clock: () => Date
  authorizeScope: ScheduledScopeAuthorizer
  /** `env.BETTER_AUTH_URL`. Injected, never read from env inside the job. */
  baseUrl: string
  activeOneClickUnsubscribeKeyVersion: () => string
  oneClickUnsubscribeUrl: (
    target: Readonly<{ kind: 'digest'; id: string }>,
    keyVersion: string,
  ) => string
  enqueueImmediate: (data: {
    notificationEmailId: string
    organizationId: string
    propertyId: string
  }) => Promise<void>
}>

const retryAt = (now: Date, retryCount: number): Date =>
  new Date(now.getTime() + Math.min(60 * 60_000, 30_000 * 2 ** retryCount))

// ── Per-recipient pipeline ──────────────────────────────────────────

type RecipientContext = Readonly<{
  orgId: OrganizationId
  userId: UserId
  rawOrgId: string
  now: Date
  timezone: string
  timezoneSource: string
}>

/**
 * Drop rows whose property is no longer authorized for scheduled delivery. The
 * digest is recipient-scoped but authorization is still per property, so this
 * keeps the pre-existing gate exactly where it was — one check per distinct
 * property, not one per row.
 */
async function authorizedEntries(
  deps: DigestDeps,
  rawOrgId: string,
  entries: readonly NotificationEmail[],
): Promise<readonly NotificationEmail[]> {
  const verdicts = new Map<string, boolean>()
  const kept: NotificationEmail[] = []
  for (const entry of entries) {
    const key = entry.propertyId as string
    if (!verdicts.has(key)) verdicts.set(key, await deps.authorizeScope(rawOrgId, key))
    if (verdicts.get(key)) kept.push(entry)
  }
  return kept
}

/**
 * Preference + quiet-hours filter. Both terminal branches persist AND log: a
 * suppression nobody can see is indistinguishable from a lost email.
 */
async function partitionDeliverable(
  deps: DigestDeps,
  ctx: RecipientContext,
  entries: readonly NotificationEmail[],
): Promise<readonly NotificationEmail[]> {
  const deliverable: NotificationEmail[] = []
  for (const entry of entries) {
    const propId = propertyId(entry.propertyId as string)
    const emailId = notificationEmailId(entry.id as string)
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
async function suppressAll(
  deps: DigestDeps,
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
 * Pair each queue row with its in-app notification. Reads are per property
 * because the repository enforces property scope on the notification table.
 */
async function loadItems(
  deps: DigestDeps,
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
  return items
}

async function recordOutcomes(
  deps: DigestDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
  contentDigest: string,
  outcome: Awaited<ReturnType<EmailSenderPort['send']>>,
  maxRetry: number,
): Promise<void> {
  const settled = await deps.emailRepo.settleDigestBatch({
    batchId: batch.id,
    organizationId: ctx.orgId,
    userId: ctx.userId,
    expectedContentDigest: contentDigest,
    settlement:
      outcome.kind === 'accepted'
        ? {
            kind: 'accepted',
            providerMessageId: outcome.providerMessageId,
            acceptedAt: outcome.acceptedAt,
          }
        : {
            kind: 'rejected',
            classification: outcome.classification,
            nextAttemptAt:
              outcome.classification === 'transient' ? retryAt(ctx.now, maxRetry) : null,
            failedAt: ctx.now,
          },
  })
  if (!settled) {
    deps.logger.error(
      { batchId: batch.id, state: batch.state },
      'Digest outcome was not persisted because the batch changed',
    )
  }
}

async function buildProviderRequest(
  deps: DigestDeps,
  ctx: RecipientContext,
  recipient: string,
  items: readonly DigestItem[],
  batchId: string,
  unsubscribeKeyVersion: string,
): Promise<
  Readonly<{
    to: string
    subject: string
    html: string
    text: string
    headers: Readonly<Record<string, string>>
  }>
> {
  const orgScope = await deps.resolveOrganizationScope(ctx.rawOrgId)
  // An aggregate digest is never legally-required mail, so its mail class is a
  // literal rather than something derived from its contents. ADR 0046 r.7
  // guard: throws before the provider call rather than shipping a digest with
  // no way out.
  const preferencesUrl = assertPreferencesLink(
    'optional',
    absoluteUrl(deps.baseUrl, PREFERENCES_PATH),
  )
  const email = renderDigestEmail({
    recipientName: await deps.userLookup.getName(ctx.userId),
    dateLabel: localDateLabel(ctx.now, ctx.timezone),
    groups: groupItemsByProperty(items, orgScope.propertyNames, (path, search) =>
      absoluteUrl(deps.baseUrl, path, search),
    ),
    preferencesUrl,
  })
  // Expand/contract compatibility: an open batch created by an older worker
  // used the preferences page in this header. Reproduce that exact request;
  // only newly prepared batches receive the signed RFC 8058 capability.
  const unsubscribeUrl =
    unsubscribeKeyVersion === 'legacy'
      ? preferencesUrl
      : deps.oneClickUnsubscribeUrl(
          { kind: 'digest', id: batchId },
          unsubscribeKeyVersion,
        )
  return {
    to: recipient,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: unsubscribeHeaders('optional', unsubscribeUrl),
  }
}

async function dispatch(
  deps: DigestDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
  request: Awaited<ReturnType<typeof buildProviderRequest>>,
  items: readonly DigestItem[],
  contentDigest: string,
): Promise<void> {
  const maxRetry = Math.max(...items.map((item) => item.entry.retryCount))

  try {
    const outcome = await deps.emailSender.send({
      ...request,
      idempotencyKey: batch.providerIdempotencyKey,
    })
    await recordOutcomes(deps, ctx, batch, contentDigest, outcome, maxRetry)
    if (outcome.kind !== 'accepted') {
      deps.logger.warn(
        {
          toPrefix: maskEmail(request.to),
          batchId: batch.id,
          entries: items.length,
          classification: outcome.classification,
          providerCode: outcome.providerCode,
        },
        'Daily digest rejected by provider',
      )
    }
  } catch (error) {
    deps.logger.error(
      {
        error,
        toPrefix: maskEmail(request.to),
        batchId: batch.id,
        entries: items.length,
      },
      'Daily digest provider call failed',
    )
    await recordOutcomes(
      deps,
      ctx,
      batch,
      contentDigest,
      { kind: 'rejected', classification: 'transient', providerCode: null },
      maxRetry,
    )
  }
}

const sameIds = (
  entries: readonly NotificationEmail[],
  expected: readonly NotificationEmail[],
): boolean =>
  entries.length === expected.length &&
  entries.every((entry, index) => entry.id === expected[index]?.id)

const batchReadiness = (
  entries: readonly NotificationEmail[],
  now: Date,
): 'ready' | 'wait' | 'invalid' => {
  if (entries.length === 0) return 'invalid'
  for (const entry of entries) {
    if (!['pending', 'failed', 'delayed'].includes(entry.status)) return 'invalid'
    if (entry.status === 'failed' && entry.lastErrorClass !== 'transient') {
      return 'invalid'
    }
    if (entry.retryCount >= 5) return 'invalid'
    if (entry.notBefore && entry.notBefore > now) return 'wait'
    if (entry.nextAttemptAt && entry.nextAttemptAt > now) return 'wait'
  }
  return 'ready'
}

async function invalidateBatch(
  deps: DigestDeps,
  ctx: RecipientContext,
  batch: NotificationDigestBatch,
  reason: string,
): Promise<void> {
  await deps.emailRepo.settleDigestBatch({
    batchId: batch.id,
    organizationId: ctx.orgId,
    userId: ctx.userId,
    expectedContentDigest: batch.contentDigest,
    settlement: { kind: 'invalidated', reason, invalidatedAt: ctx.now },
  })
  deps.logger.warn({ batchId: batch.id, reason }, 'Digest batch invalidated')
}

/** ADR 0046 r.4: one digest, one recipient, the recipient's timezone. */
async function sendUserDigest(
  deps: DigestDeps,
  recipientScope: NotificationEmailRecipient,
): Promise<void> {
  const now = deps.clock()
  const rawOrgId = recipientScope.organizationId as string
  const orgId = organizationId(rawOrgId)
  const [settings, orgScope] = await Promise.all([
    deps.preferenceRepo.getUserSettings(recipientScope.userId, orgId),
    deps.resolveOrganizationScope(rawOrgId),
  ])
  const sources = {
    userTimezone: settings?.timezone ?? null,
    organizationTimezone: orgScope.timezone,
  }
  const ctx: RecipientContext = {
    orgId,
    userId: recipientScope.userId,
    rawOrgId,
    now,
    timezone: resolveRecipientTimezone(sources),
    timezoneSource: recipientTimezoneSource(sources),
  }

  const openBatch = await deps.emailRepo.findOpenDigestBatch(orgId, ctx.userId)
  const due = openBatch
    ? await deps.emailRepo.findDigestBatchEntries(openBatch.id, orgId, ctx.userId)
    : await deps.emailRepo.findDueByUser(orgId, ctx.userId, 'daily', now)
  if (openBatch) {
    const readiness = batchReadiness(due, now)
    if (readiness === 'wait') return
    if (readiness === 'invalid') {
      await invalidateBatch(deps, ctx, openBatch, 'digest_membership_unavailable')
      return
    }
  }
  const authorized = await authorizedEntries(deps, rawOrgId, due)
  if (openBatch && !sameIds(authorized, due)) {
    await invalidateBatch(deps, ctx, openBatch, 'digest_authorization_changed')
    return
  }
  // Outside the recipient's 08:00 window only rows already parked by quiet
  // hours are eligible, so the hourly sweep can release them without turning
  // every sweep into a digest send.
  const candidates = openBatch
    ? authorized
    : isDailyDigestWindow(now, ctx.timezone)
      ? authorized
      : authorized.filter((entry) => entry.status === 'delayed')
  if (candidates.length === 0) return

  const deliverable = await partitionDeliverable(deps, ctx, candidates)
  if (openBatch && !sameIds(deliverable, due)) {
    await invalidateBatch(deps, ctx, openBatch, 'digest_membership_invalidated')
    return
  }
  if (deliverable.length === 0) return

  if (await deps.emailRepo.isRecipientSuppressed(ctx.userId, orgId)) {
    if (openBatch) {
      await invalidateBatch(deps, ctx, openBatch, 'recipient_bounced')
      return
    }
    await suppressAll(deps, ctx, deliverable, 'recipient_bounced')
    return
  }
  const recipient = await deps.userLookup.getEmail(ctx.userId)
  if (!recipient) {
    if (openBatch) {
      await invalidateBatch(deps, ctx, openBatch, 'recipient_unavailable')
      return
    }
    await suppressAll(deps, ctx, deliverable, 'recipient_unavailable')
    return
  }

  const items = await loadItems(deps, ctx, deliverable)
  if (items.length === 0) {
    if (openBatch) {
      await invalidateBatch(deps, ctx, openBatch, 'notification_source_unavailable')
      return
    }
    deps.logger.warn(
      { entries: deliverable.length },
      'Digest skipped — no readable notification for any due entry',
    )
    return
  }
  if (openBatch && items.length !== deliverable.length) {
    await invalidateBatch(deps, ctx, openBatch, 'notification_source_unavailable')
    return
  }

  const batchId = openBatch?.id ?? notificationDigestBatchId(randomUUID())
  const unsubscribeKeyVersion =
    openBatch?.unsubscribeKeyVersion ?? deps.activeOneClickUnsubscribeKeyVersion()
  const request = await buildProviderRequest(
    deps,
    ctx,
    recipient,
    items,
    batchId as string,
    unsubscribeKeyVersion,
  )
  const contentDigest = digestProviderRequest(request)
  if (openBatch) {
    if (
      digestMemberSet(deliverable.map((entry) => entry.id as string)) !==
      openBatch.memberDigest
    ) {
      await invalidateBatch(deps, ctx, openBatch, 'digest_membership_changed')
      return
    }
    if (contentDigest !== openBatch.contentDigest) {
      await deps.emailRepo.settleDigestBatch({
        batchId: openBatch.id,
        organizationId: ctx.orgId,
        userId: ctx.userId,
        expectedContentDigest: contentDigest,
        settlement: { kind: 'content_mismatch', detectedAt: ctx.now },
      })
      deps.logger.error(
        { batchId: openBatch.id },
        'Digest retry blocked because provider-visible content changed',
      )
      return
    }
    await dispatch(deps, ctx, openBatch, request, items, contentDigest)
    return
  }

  const memberIds = deliverable.map((entry) => notificationEmailId(entry.id as string))
  const memberDigest = digestMemberSet(memberIds)
  const localDate = localDateKey(ctx.now, ctx.timezone)
  const prepared = await deps.emailRepo.prepareDigestBatch({
    id: batchId,
    organizationId: ctx.orgId,
    userId: ctx.userId,
    localDate,
    memberIds,
    memberDigest,
    contentDigest,
    providerIdempotencyKey: digestBatchIdempotencyKey({
      organizationId: ctx.rawOrgId,
      userId: ctx.userId as string,
      localDate,
      batchId,
      memberDigest,
    }),
    unsubscribeKeyVersion,
    preparedAt: ctx.now,
  })
  if (!prepared.created) {
    deps.logger.info(
      { batchId: prepared.batch.id },
      'Digest preparation deferred to the worker that owns the open batch',
    )
    return
  }
  await dispatch(deps, ctx, prepared.batch, request, items, contentDigest)
}

// ── Immediate orphan sweep ──────────────────────────────────────────

/**
 * Recovery path for an urgent email whose enqueue failed at insert time (the
 * queue row survives, the job does not). Property-scoped on purpose: an urgent
 * email belongs to exactly one property, and the scope gate is per property.
 */
async function sweepImmediateOrphans(deps: DigestDeps, now: Date): Promise<void> {
  const scopes = await deps.pool.query<PropertyScope>(
    `SELECT organization_id, id::text AS property_id
       FROM properties
      WHERE deleted_at IS NULL
        AND lifecycle_state = 'active'`,
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
      for (const entry of orphans) {
        await deps.enqueueImmediate({
          notificationEmailId: entry.id as string,
          organizationId: scope.organization_id,
          propertyId: scope.property_id,
        })
      }
      if (orphans.length > 0) {
        deps.logger.info(
          { orphans: orphans.length },
          'Re-enqueued immediate notification emails missed by the urgent path',
        )
      }
    } catch (error) {
      deps.logger.error({ error }, 'Immediate email orphan sweep failed for property')
    }
  }
}

export const createDigestNotificationJobHandler = (deps: DigestDeps) => {
  return async (_job: Job<void>): Promise<void> => {
    await sweepImmediateOrphans(deps, deps.clock())

    const recipients = await deps.emailRepo.findDueRecipients('daily', deps.clock())
    for (const recipientScope of recipients) {
      try {
        await sendUserDigest(deps, recipientScope)
      } catch (error) {
        // One bad recipient must not abort the sweep for everyone else.
        deps.logger.error({ error }, 'Daily digest failed for recipient')
      }
    }
  }
}
