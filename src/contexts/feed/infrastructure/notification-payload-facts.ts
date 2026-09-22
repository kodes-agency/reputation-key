// Feed notification surface — payload assembly for durable consumers (ADR 0046 r.8).
//
// Consumers enqueue facts and let domain/notification-templates.ts write the
// sentence. This module gathers the allowlisted facts shared by inbox-backed
// notification routes.
//
// Two rules hold everywhere below:
//
//  1. ALLOWLIST. Only what ADR 0046 r.8 permits crosses this boundary: property
//     name, locally collected Portal rating, platform enum, when the current
//     wait began, actor ROLE,
//     whether an approver gave a reason (never the reason), and registered
//     display names (goal/badge/portal). The inbox row also holds a snippet, a
//     reviewer name and media — those are never read here.
//  2. BEST EFFORT. A failed or empty lookup degrades the COPY, never loses the
//     notification: every template renders correctly from `{}`. Each lookup is
//     wrapped so BullMQ delivery does not retry a permanently unavailable detail.

import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxItemId, OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { DisplayNameLookupPort } from '../application/ports/notification-display-name-lookup.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type {
  NotificationPayload,
  NotificationPlatform,
  NotificationPublishFailureCause,
  NotificationPublishOutcome,
} from '../domain/notification-payload'

/**
 * `inbox_items.source_type` -> the platform the content came from. A review is
 * Google-sourced; feedback is collected through our own portal.
 */
const PLATFORM_BY_SOURCE: Readonly<Record<string, NotificationPlatform>> = {
  review: 'google',
  feedback: 'portal',
}

export type InboxPayloadDeps = Readonly<{
  inboxItemLookup: InboxItemLookupPort
  userLookup: UserLookupPort
  logger: LoggerPort
}>

/** Best-effort read: a throw costs the copy some detail, never the notification. */
const attempt = async <T>(
  logger: LoggerPort,
  what: string,
  read: () => Promise<T | null>,
): Promise<T | null> => {
  try {
    return await read()
  } catch (err) {
    logger.warn({ err }, `notification payload: ${what} lookup failed, degrading copy`)
    return null
  }
}

export type InboxPayloadInput = Readonly<{
  inboxItemId: InboxItemId
  orgId: OrganizationId
  /** Whoever's action produced this notification. Resolved to a ROLE, never a name. */
  actorId?: UserId | null
  /** Whether the approver gave a reason (reply.rejected only); null when unknown. */
  hasModerationReason?: boolean | null
  /** How the publication ended (reply.publish_failed only); null when unknown. */
  publishOutcome?: NotificationPublishOutcome | null
  /** Closed cause of a failed publication (reply.publish_failed only). */
  publishFailureCause?: NotificationPublishFailureCause | null
  /**
   * Stamp when the current wait began, for a notice about something still
   * waiting on the reader (approval, escalation, a Response Target reminder).
   * Notices about work already done carry no wait.
   */
  measureWait?: boolean
}>

/**
 * Facts for the inbox-keyed notification types: where it happened, how bad a
 * locally collected Portal rating, when the current wait began (where the
 * notice is about a wait), and — where a person's action drove it — the role
 * of whoever acted. Google/provider ratings never cross into Notification
 * storage.
 */
export const buildInboxItemPayload = async (
  deps: InboxPayloadDeps,
  input: InboxPayloadInput,
): Promise<NotificationPayload> => {
  const actorId = input.actorId
  const [facts, actorRole, waitingSince] = await Promise.all([
    attempt(deps.logger, 'inbox item facts', () =>
      deps.inboxItemLookup.findInboxItemFacts(input.inboxItemId, input.orgId),
    ),
    actorId
      ? attempt(deps.logger, 'actor role', () =>
          deps.userLookup.findActorRole(actorId, input.orgId),
        )
      : null,
    input.measureWait
      ? attempt(deps.logger, 'waiting since', () =>
          deps.inboxItemLookup.findWaitingSince(input.inboxItemId, input.orgId),
        )
      : null,
  ])

  const payload: Record<string, unknown> = {}
  if (facts) {
    if (facts.propertyName !== null) payload.propertyName = facts.propertyName
    if (facts.sourceType === 'feedback' && facts.guestRating !== null) {
      payload.guestRating = facts.guestRating
    }
    const platform = PLATFORM_BY_SOURCE[facts.sourceType]
    if (platform !== undefined) payload.platform = platform
  }
  // An instant, not an age: copy measures it when it is read, so an old row
  // never shows the age it had when it arrived.
  if (waitingSince !== null) payload.waitingSince = waitingSince.toISOString()
  if (actorRole !== null) payload.actorRole = actorRole
  // Set even when false: a rejection without a reason must replace the flag of
  // an earlier one that had a reason when the two rows coalesce.
  if (typeof input.hasModerationReason === 'boolean') {
    payload.hasModerationReason = input.hasModerationReason
  }
  if (input.publishOutcome) payload.publishOutcome = input.publishOutcome
  if (input.publishFailureCause) payload.publishFailureCause = input.publishFailureCause
  return payload as NotificationPayload
}

export type PropertyPayloadDeps = Readonly<{
  displayNames: Pick<DisplayNameLookupPort, 'findPropertyName'>
  logger: LoggerPort
}>

/**
 * The Property's name for a Property-scoped notice with no Inbox item behind
 * it (grouped assignment, goals, Portal and Property responsibility), so a
 * reader with several Properties can tell its rows and emails apart.
 */
export const buildPropertyPayload = async (
  deps: PropertyPayloadDeps,
  orgId: OrganizationId,
  propertyId: PropertyId,
): Promise<NotificationPayload> => {
  const name = await attempt(deps.logger, 'property name', () =>
    deps.displayNames.findPropertyName(orgId, propertyId),
  )
  return name === null ? {} : { propertyName: name }
}

export type OrganizationPayloadDeps = Readonly<{
  displayNames: Pick<DisplayNameLookupPort, 'findOrganizationName'>
  logger: LoggerPort
}>

/** The Organization's name for an Organization-scoped notice. */
export const buildOrganizationPayload = async (
  deps: OrganizationPayloadDeps,
  orgId: OrganizationId,
): Promise<NotificationPayload> => {
  const name = await attempt(deps.logger, 'organization name', () =>
    deps.displayNames.findOrganizationName(orgId),
  )
  return name === null ? {} : { organizationName: name }
}
