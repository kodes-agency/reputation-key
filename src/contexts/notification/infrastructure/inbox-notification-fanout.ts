// Notification context — the ONE fan-out path from "an inbox item exists" to
// "an insert-notification job is queued for every recipient".
//
// Three callers share it, and that is the point: the in-process bus handler
// (event-handlers/on-inbox-item-created.ts), the durable outbox consumer
// (outbox-consumers.ts), and the reconciliation sweep
// (jobs/reconcile-missing-notifications.job.ts). Before this module the bus
// handler was the only implementation, so the durable path and the sweep would
// each have had to re-derive recipient resolution, the AccountAdmin fallback,
// the source→type mapping and the payload allowlist — three chances to drift
// on who gets notified about a new review.
//
// Content-free by construction: the job data carries identifiers plus the
// ADR 0046 r.8 fact allowlist that buildInboxItemPayload assembles, never
// review text, guest names or media.

import type { JobsOptions } from 'bullmq'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  inboxItemId as brandInboxItemId,
  organizationId as brandOrganizationId,
  unbrand,
  type UserId,
} from '#/shared/domain/ids'
import { buildInboxItemPayload } from './event-handlers/payload-facts'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import type { NotificationType } from '../domain/types'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import {
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
  resolveResponsibleRecipients,
} from '../application/responsible-recipients'
import type { NotificationAudience } from '../application/notification-audience'

/**
 * The enqueue surface the fan-out needs. A bullmq `Queue` satisfies it, and so
 * does the catalogue-policy wrapper (`withCatalogueJobOptions`) the composition
 * root installs — which is why the fan-out never sets retry options itself.
 */
export type NotificationJobEnqueuePort = Readonly<{
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>
}>

export type InboxFanoutDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: InboxItemLookupPort
  clock: () => Date
  logger: LoggerPort
}>

/**
 * `inbox_items.source_type` → the notification type. A review and a piece of
 * portal feedback are the same workflow but not the same sentence (ADR 0022),
 * and any other source type is not a user-visible notification at all.
 */
const TYPE_BY_SOURCE: Readonly<Record<string, NotificationType>> = {
  review: 'review.created',
  feedback: 'feedback.created',
}

export type InboxFanoutInput = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId: string | null | undefined
  sourceType: string
  /**
   * Stamped onto the notification row's `event_id`. The bus and durable paths
   * pass the originating event id; the sweep passes its own healing origin, so
   * a backfilled row is distinguishable from a happy-path one.
   */
  eventId: string
  correlationId?: string | null
  /**
   * When set, each enqueue gets the deterministic job id
   * `<jobIdScope>-<userId>`. The durable consumer uses it so an ambiguous
   * relay redelivery converges instead of coalescing a second time; the bus
   * handler and the sweep leave it unset (see the sweep's own note).
   */
  jobIdScope?: string | null
}>

export type InboxFanoutOutcome =
  | Readonly<{
      kind: 'skipped'
      reason: 'unknown_source' | 'no_property' | 'no_recipients'
    }>
  | Readonly<{ kind: 'enqueued'; recipients: number }>

/**
 * Resolve current source-specific responsibility: Property for Google reviews,
 * Portal for private feedback. AccountAdmins are recovery only when no eligible
 * scoped manager remains; access and Staff attribution are never substituted.
 */
const resolveRecipients = async (
  deps: InboxFanoutDeps,
  orgId: string,
  propertyId: string,
  inboxItemId: string,
  sourceType: string,
): Promise<
  Readonly<{ recipients: readonly UserId[]; audience: NotificationAudience }>
> => {
  const org = brandOrganizationId(orgId)
  const facts = await deps.inboxItemLookup.findInboxItemFacts(
    brandInboxItemId(inboxItemId),
    org,
  )
  if (facts) {
    return {
      recipients: await resolveInboxResponsibleRecipients(deps, org, facts),
      audience: inboxNotificationAudience(facts),
    }
  }
  if (sourceType === 'review') {
    const scope = { kind: 'property' as const, propertyId }
    return {
      recipients: await resolveResponsibleRecipients(deps, org, scope),
      audience: { kind: 'responsible_scope', scope },
    }
  }
  // Private feedback without a recoverable Portal attribution goes only to
  // AccountAdmin recovery, never to access holders or arbitrary Property staff.
  return {
    recipients: await deps.userLookup.findByRole(org, 'AccountAdmin'),
    audience: { kind: 'account_admin' },
  }
}

/**
 * Enqueue one insert-notification job per recipient for a single inbox item.
 * Returns why nothing was enqueued rather than logging-and-returning, so the
 * durable consumer can turn "nothing to do" into an `obsolete` receipt and the
 * sweep can count it.
 */
export const fanoutInboxItemNotifications = async (
  deps: InboxFanoutDeps,
  input: InboxFanoutInput,
): Promise<InboxFanoutOutcome> => {
  const correlationId = input.correlationId ?? undefined
  const type = TYPE_BY_SOURCE[input.sourceType]
  if (type === undefined) {
    deps.logger.debug('inbox notification fan-out: skipping unknown source', {
      sourceType: input.sourceType,
    })
    return { kind: 'skipped', reason: 'unknown_source' }
  }

  if (!input.propertyId) {
    deps.logger.debug('inbox notification fan-out: no propertyId, skipping', {
      correlationId,
    })
    return { kind: 'skipped', reason: 'no_property' }
  }

  const { recipients, audience } = await resolveRecipients(
    deps,
    input.organizationId,
    input.propertyId,
    input.inboxItemId,
    input.sourceType,
  )
  if (recipients.length === 0) {
    deps.logger.warn({ correlationId }, 'inbox notification fan-out: no recipients found')
    return { kind: 'skipped', reason: 'no_recipients' }
  }

  // No actor: nobody on the team created this, a guest did — and a guest is
  // never named in a notification (ADR 0046 r.8).
  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: brandInboxItemId(input.inboxItemId),
    orgId: brandOrganizationId(input.organizationId),
  })

  await Promise.all(
    recipients.map((recipient) => {
      const data = {
        userId: recipient,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        type,
        resourceType: 'inbox_item',
        resourceId: input.inboxItemId,
        eventId: input.eventId,
        payload,
        audience,
      }
      // Two-arg enqueue unless a deterministic id was asked for: the catalogue
      // policy wrapper supplies attempts/backoff, and passing an explicit
      // `undefined` third argument would only obscure the call.
      return input.jobIdScope
        ? deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data, {
            jobId: `${input.jobIdScope}-${unbrand(recipient)}`,
          })
        : deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
    }),
  )

  return { kind: 'enqueued', recipients: recipients.length }
}
