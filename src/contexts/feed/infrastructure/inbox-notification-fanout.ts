// Feed notification surface — the ONE fan-out path from "an inbox item exists" to
// "a notice is written for every recipient".
//
// The durable outbox consumer owns this definition, so recipient resolution,
// AccountAdmin fallback, source-to-type mapping, the payload allowlist, and the
// rule that Google history is never announced cannot drift.
//
// Content-free by construction: the notice carries identifiers plus the
// ADR 0046 r.8 fact allowlist that buildInboxItemPayload assembles, never
// review text, guest names or media.

import type { Notice, NoticeDeliveryDeps } from '../notify/consumers.server'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  inboxItemId as brandInboxItemId,
  organizationId as brandOrganizationId,
  propertyId as brandPropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { buildInboxItemPayload } from './notification-payload-facts'
import type { NotificationType } from '../domain/notification-types'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import {
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
  resolveResponsibleRecipients,
} from '../application/responsible-recipients'
import type { NotificationAudience } from '../application/notification-audience'

/** One item's workflow fact, with each recipient's reason for admission intact. */
export const inboxWorkflowNotices = (
  common: Pick<Notice, 'organizationId' | 'propertyId' | 'resourceId' | 'payload'>,
  recipients: ReadonlyArray<Pick<Notice, 'userId' | 'type' | 'audience'>>,
): ReadonlyArray<Notice> =>
  recipients.map((recipient) => ({
    ...common,
    ...recipient,
    resourceType: 'inbox_item',
  }))

export type InboxFanoutDeps = NoticeDeliveryDeps &
  Readonly<{
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
  correlationId?: string | null
}>

export type InboxFanoutOutcome =
  | Readonly<{
      kind: 'skipped'
      reason: 'unknown_source' | 'no_property' | 'historical_onboarding' | 'no_recipients'
    }>
  | Readonly<{ kind: 'notices'; notices: ReadonlyArray<Notice> }>

/**
 * History does not fan out (ADR 0046): a past review an import brought in is
 * not news, and announcing each one as new buries the Property's real work.
 * Only a Google review can be history; private feedback is always new.
 */
const isImportedHistory = (
  deps: InboxFanoutDeps,
  input: InboxFanoutInput,
): Promise<boolean> =>
  input.sourceType === 'review'
    ? deps.inboxItemLookup.isHistoricalOnboardingItem(
        brandInboxItemId(input.inboxItemId),
        brandOrganizationId(input.organizationId),
      )
    : Promise.resolve(false)

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
 * One notice per recipient for a single inbox item. Returns why there are none
 * rather than logging-and-returning, so the durable consumer can turn
 * "nothing to do" into an `obsolete` receipt.
 */
export const inboxItemCreatedNotices = async (
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

  const property = input.propertyId
  if (!property) {
    deps.logger.debug('inbox notification fan-out: no propertyId, skipping', {
      correlationId,
    })
    return { kind: 'skipped', reason: 'no_property' }
  }

  if (await isImportedHistory(deps, input)) {
    deps.logger.debug(
      { correlationId },
      'inbox notification fan-out: Google history is never announced',
    )
    return { kind: 'skipped', reason: 'historical_onboarding' }
  }

  const { recipients, audience } = await resolveRecipients(
    deps,
    input.organizationId,
    property,
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

  return {
    kind: 'notices',
    notices: recipients.map((recipient) => ({
      userId: recipient,
      organizationId: brandOrganizationId(input.organizationId),
      propertyId: brandPropertyId(property),
      type,
      resourceType: 'inbox_item',
      resourceId: brandInboxItemId(input.inboxItemId),
      payload,
      audience,
    })),
  }
}
