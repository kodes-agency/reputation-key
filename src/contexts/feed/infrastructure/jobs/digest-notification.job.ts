// Feed notification surface — daily digest + delivery sweep.
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
// The `immediate`-cadence orphan sweep runs first on every tick. It lives in
// `immediate-orphan-sweep.ts`: the recovery path for an immediate email whose
// enqueue failed or whose job gave up, for Property- and Organization-scoped
// rows alike.

import type { Job } from 'bullmq'
import type { Pool } from 'pg'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import {
  notificationEmailId,
  notificationDigestBatchId,
  organizationId,
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
import type { UserLookupPort } from '../../application/ports/notification-user-lookup.port'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import type { NotificationRecipientStanding } from '../../application/notification-recipient-standing'
import type { NotificationOrganizationScopeResolver } from '../repositories/notification-organization-scope.repository'
import type { NotificationPropertyScopeResolver } from '../repositories/notification-property-scope.repository'
import type { NotificationEmail } from '../../domain/notification-types'
import { isDailyDigestWindow } from '../../domain/notification-delivery-policy'
import { renderDigestEmail } from '../email/render'
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
import {
  sweepImmediateOrphans,
  type ImmediateEmailEnqueue,
} from './immediate-orphan-sweep'
import {
  authorizedEntries,
  loadItems,
  partitionDeliverable,
  retireStaleEntries,
  suppressAll,
  type RecipientContext,
} from './digest-entry-selection'
import {
  invalidateBatch,
  retireUnreadableBatch,
  selectFrozenEntries,
  supersedeBatch,
} from './digest-frozen-batch'

export const DIGEST_JOB_NAME = 'digest-notification' as const

export type DigestDeps = Readonly<{
  pool: Pool
  emailRepo: NotificationEmailRepositoryPort
  preferenceRepo: NotificationPreferenceRepositoryPort
  notifRepo: NotificationRepositoryPort
  userLookup: UserLookupPort
  emailSender: EmailSenderPort
  resolveOrganizationScope: NotificationOrganizationScopeResolver
  /** Resolves only an active Property; `null` for any other lifecycle state. */
  resolvePropertyScope: NotificationPropertyScopeResolver
  logger: LoggerPort
  clock: () => Date
  batchIdGen: () => string
  authorizeScope: ScheduledScopeAuthorizer
  /** The recipient's current membership, access and responsibility. */
  isRecipientEligible: NotificationRecipientStanding
  /** `env.BETTER_AUTH_URL`. Injected, never read from env inside the job. */
  baseUrl: string
  activeOneClickUnsubscribeKeyVersion: () => string
  oneClickUnsubscribeUrl: (
    target: Readonly<{ kind: 'digest'; id: string }>,
    keyVersion: string,
  ) => string
  enqueueImmediate: ImmediateEmailEnqueue
}>

const retryAt = (now: Date, retryCount: number): Date =>
  new Date(now.getTime() + Math.min(60 * 60_000, 30_000 * 2 ** retryCount))

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
            refusedBeforeAcceptance: outcome.refusedBeforeAcceptance === true,
          },
  })
  if (!settled) {
    deps.logger.error(
      { batchId: batch.id, digestState: batch.state },
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
  localDate: string,
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
    dateLabel: localDateLabel(localDate),
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
  // Before the call, never after: an attempt that never reports back must
  // count as possibly accepted, or a later refusal would make the batch look
  // safe to re-key.
  const started = await deps.emailRepo.startDigestAttempt({
    batchId: batch.id,
    organizationId: ctx.orgId,
    userId: ctx.userId,
    startedAt: ctx.now,
  })
  if (!started) {
    deps.logger.warn(
      { batchId: batch.id },
      'Digest attempt not started because the batch closed first',
    )
    return
  }

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

/** ADR 0046 r.4: one digest, one recipient, the recipient's timezone. */
async function resolveRecipientContext(
  deps: DigestDeps,
  recipientScope: NotificationEmailRecipient,
): Promise<RecipientContext> {
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
  return {
    orgId,
    userId: recipientScope.userId,
    rawOrgId,
    now,
    timezone: resolveRecipientTimezone(sources),
    timezoneSource: recipientTimezoneSource(sources),
  }
}

/**
 * The queue rows this sweep may actually send, or `null` when there is nothing
 * left to do — either because no row is eligible or because an open batch was
 * closed here. An open batch narrows the set to its frozen membership; a fresh
 * sweep outside the recipient's 08:00 window may only release rows that quiet
 * hours already parked.
 */
async function selectDeliverableEntries(
  deps: DigestDeps,
  ctx: RecipientContext,
  openBatch: NotificationDigestBatch | null,
): Promise<readonly NotificationEmail[] | null> {
  if (openBatch) return selectFrozenEntries(deps, ctx, openBatch)
  const due = await deps.emailRepo.findDueByUser(ctx.orgId, ctx.userId, 'daily', ctx.now)
  const authorized = await authorizedEntries(deps, ctx.rawOrgId, due)
  const fresh = await retireStaleEntries(deps, ctx, authorized)
  const candidates = isDailyDigestWindow(ctx.now, ctx.timezone)
    ? fresh
    : fresh.filter((entry) => entry.status === 'delayed')
  if (candidates.length === 0) return null

  const deliverable = await partitionDeliverable(deps, ctx, candidates)
  return deliverable.length === 0 ? null : deliverable
}

/**
 * Stop delivering for a recipient-level reason. A frozen batch is invalidated
 * as a unit; a fresh sweep suppresses the individual rows instead.
 */
async function abandonDelivery(
  deps: DigestDeps,
  ctx: RecipientContext,
  openBatch: NotificationDigestBatch | null,
  deliverable: readonly NotificationEmail[],
  reason: string,
): Promise<void> {
  if (openBatch) {
    await invalidateBatch(deps, ctx, openBatch, reason)
    return
  }
  await suppressAll(deps, ctx, deliverable, reason)
}

/**
 * A batch the provider refused outright on every attempt (a rate or quota
 * limit) was never accepted, so its idempotency key protects no delivered
 * mail. When it changed since — a repeat event coalesced into a member, the
 * recipient was renamed, a member dropped — the batch is retired and its
 * remaining members go out in a fresh batch under a new key, rather than the
 * day's digest being suppressed.
 */
async function reprepareRefusedBatch(
  deps: DigestDeps,
  ctx: RecipientContext,
  openBatch: NotificationDigestBatch,
  members: readonly NotificationEmail[],
  request: Awaited<ReturnType<typeof buildProviderRequest>>,
  items: readonly DigestItem[],
  contentDigest: string,
): Promise<void> {
  if (!(await supersedeBatch(deps, ctx, openBatch, contentDigest))) return
  const batchId = notificationDigestBatchId(deps.batchIdGen())
  const unsubscribeKeyVersion = deps.activeOneClickUnsubscribeKeyVersion()
  const fresh = await buildProviderRequest(
    deps,
    ctx,
    request.to,
    items,
    batchId as string,
    unsubscribeKeyVersion,
    openBatch.localDate,
  )
  deps.logger.info(
    { batchId: openBatch.id, replacementBatchId: batchId },
    'Refused digest batch re-prepared under a new key because it changed',
  )
  await prepareAndDispatchBatch(
    deps,
    ctx,
    batchId,
    members,
    fresh,
    items,
    digestProviderRequest(fresh),
    unsubscribeKeyVersion,
    openBatch.localDate,
  )
}

/**
 * Retry path for a batch already frozen by an earlier sweep. Membership and
 * provider-visible content must both still match what was recorded, otherwise
 * the retry would send different mail under the same idempotency key. A
 * change re-prepares a batch the provider refused on every attempt; any other
 * batch may have been accepted, so it is closed rather than mailed twice.
 */
async function retryOpenBatch(
  deps: DigestDeps,
  ctx: RecipientContext,
  openBatch: NotificationDigestBatch,
  members: readonly NotificationEmail[],
  request: Awaited<ReturnType<typeof buildProviderRequest>>,
  items: readonly DigestItem[],
  contentDigest: string,
): Promise<void> {
  const membershipChanged =
    digestMemberSet(members.map((entry) => entry.id as string)) !== openBatch.memberDigest
  const contentChanged = contentDigest !== openBatch.contentDigest
  if (!membershipChanged && !contentChanged) {
    await dispatch(deps, ctx, openBatch, request, items, contentDigest)
    return
  }
  if (openBatch.everyAttemptRefused) {
    await reprepareRefusedBatch(
      deps,
      ctx,
      openBatch,
      members,
      request,
      items,
      contentDigest,
    )
    return
  }
  if (membershipChanged) {
    await invalidateBatch(deps, ctx, openBatch, 'digest_membership_changed')
    return
  }
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
}

/** Freeze a new batch and send it, unless another worker won the race. */
async function prepareAndDispatchBatch(
  deps: DigestDeps,
  ctx: RecipientContext,
  batchId: ReturnType<typeof notificationDigestBatchId>,
  deliverable: readonly NotificationEmail[],
  request: Awaited<ReturnType<typeof buildProviderRequest>>,
  items: readonly DigestItem[],
  contentDigest: string,
  unsubscribeKeyVersion: string,
  localDate: string,
): Promise<void> {
  const memberIds = deliverable.map((entry) => notificationEmailId(entry.id as string))
  const memberDigest = digestMemberSet(memberIds)
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

async function sendUserDigest(
  deps: DigestDeps,
  recipientScope: NotificationEmailRecipient,
): Promise<void> {
  const ctx = await resolveRecipientContext(deps, recipientScope)
  const openBatch = await deps.emailRepo.findOpenDigestBatch(ctx.orgId, ctx.userId)
  const deliverable = await selectDeliverableEntries(deps, ctx, openBatch)
  if (deliverable === null) return

  const recipient = await deps.userLookup.getEmail(ctx.userId)
  if (!recipient) {
    await abandonDelivery(deps, ctx, openBatch, deliverable, 'recipient_unavailable')
    return
  }
  // ADR 0046 r.6: an address the provider refused for good, from any
  // Organization, is never attempted again.
  if (await deps.emailRepo.isAddressSuppressed(recipient)) {
    await abandonDelivery(deps, ctx, openBatch, deliverable, 'recipient_bounced')
    return
  }

  const items = await loadItems(deps, ctx, deliverable)
  if (items.length === 0) {
    if (openBatch) {
      await retireUnreadableBatch(deps, ctx, openBatch)
      return
    }
    deps.logger.warn(
      { entries: deliverable.length },
      'Digest skipped — no readable notification for any due entry',
    )
    return
  }
  if (
    openBatch &&
    !openBatch.everyAttemptRefused &&
    items.length !== deliverable.length
  ) {
    await invalidateBatch(deps, ctx, openBatch, 'notification_source_unavailable')
    return
  }
  // A refused batch goes on with the members whose notification still reads.
  const members = openBatch ? items.map((item) => item.entry) : deliverable

  const batchId = openBatch?.id ?? notificationDigestBatchId(deps.batchIdGen())
  const unsubscribeKeyVersion =
    openBatch?.unsubscribeKeyVersion ?? deps.activeOneClickUnsubscribeKeyVersion()
  const localDate = openBatch?.localDate ?? localDateKey(ctx.now, ctx.timezone)
  const request = await buildProviderRequest(
    deps,
    ctx,
    recipient,
    items,
    batchId as string,
    unsubscribeKeyVersion,
    localDate,
  )
  const contentDigest = digestProviderRequest(request)
  if (openBatch) {
    await retryOpenBatch(deps, ctx, openBatch, members, request, items, contentDigest)
    return
  }
  await prepareAndDispatchBatch(
    deps,
    ctx,
    batchId,
    deliverable,
    request,
    items,
    contentDigest,
    unsubscribeKeyVersion,
    localDate,
  )
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
