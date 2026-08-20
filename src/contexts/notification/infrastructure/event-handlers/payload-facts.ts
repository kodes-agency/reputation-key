// Notification context — payload assembly for event handlers (ADR 0046 r.8).
//
// Handlers used to hand-write sentences ("Inbox item 61ed98fc-… has been
// escalated"), because the events they consume carry ids and nothing else. They
// now emit FACTS and let domain/notification-templates.ts write the sentence.
// This module is where those facts are gathered.
//
// Two rules hold everywhere below:
//
//  1. ALLOWLIST. Only what ADR 0046 r.8 permits crosses this boundary: property
//     name, star rating, platform enum, waiting age, actor ROLE, the
//     staff-authored moderation reason, and registered display names
//     (goal/badge/portal). The inbox row also holds a snippet, a reviewer name
//     and media — those are never read here.
//  2. BEST EFFORT. A failed or empty lookup degrades the COPY, never loses the
//     notification: every template renders correctly from `{}`. So each lookup
//     is wrapped and a failure yields fewer keys rather than a thrown handler,
//     which BullMQ would only retry into the same failure.

import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  BadgeId,
  GoalId,
  InboxItemId,
  OrganizationId,
  PortalGroupId,
  PortalId,
  UserId,
} from '#/shared/domain/ids'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { RecognitionLookupPort } from '../../application/ports/recognition-lookup.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type {
  NotificationPayload,
  NotificationPlatform,
} from '../../domain/notification-payload'

const MS_PER_HOUR = 3_600_000

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
  clock: () => Date
  logger: LoggerPort
}>

export type RecognitionPayloadDeps = Readonly<{
  recognitionLookup: RecognitionLookupPort
  logger: LoggerPort
}>

export type BadgeTarget =
  | Readonly<{ kind: 'portal'; id: PortalId }>
  | Readonly<{ kind: 'portal_group'; id: PortalGroupId }>

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
  /** Staff-authored rejection reason (reply.rejected only). */
  moderationReason?: string | null
}>

/**
 * Facts for the nine inbox-keyed notification types: where it happened, how bad
 * the rating is, how long it has been waiting, and — where a person's action
 * drove it — the role of whoever acted.
 */
export const buildInboxItemPayload = async (
  deps: InboxPayloadDeps,
  input: InboxPayloadInput,
): Promise<NotificationPayload> => {
  const actorId = input.actorId
  const [facts, actorRole] = await Promise.all([
    attempt(deps.logger, 'inbox item facts', () =>
      deps.inboxItemLookup.findInboxItemFacts(input.inboxItemId, input.orgId),
    ),
    actorId
      ? attempt(deps.logger, 'actor role', () =>
          deps.userLookup.findActorRole(actorId, input.orgId),
        )
      : null,
  ])

  const payload: Record<string, unknown> = {}
  if (facts) {
    if (facts.propertyName !== null) payload.propertyName = facts.propertyName
    if (facts.rating !== null) payload.rating = facts.rating
    const platform = PLATFORM_BY_SOURCE[facts.sourceType]
    if (platform !== undefined) payload.platform = platform
    // Floored hours since the item landed. Below one hour the templates render
    // no age at all, so a fresh item never claims to have been waiting.
    payload.waitingHours = Math.max(
      0,
      Math.floor((deps.clock().getTime() - facts.createdAt.getTime()) / MS_PER_HOUR),
    )
  }
  if (actorRole !== null) payload.actorRole = actorRole
  if (input.moderationReason) payload.moderationReason = input.moderationReason
  return payload as NotificationPayload
}

/** Facts for `goal.completed`: which goal, at which property. */
export const buildGoalPayload = async (
  deps: RecognitionPayloadDeps,
  input: Readonly<{ goalId: GoalId; orgId: OrganizationId }>,
): Promise<NotificationPayload> => {
  const facts = await attempt(deps.logger, 'goal facts', () =>
    deps.recognitionLookup.findGoalFacts(input.goalId, input.orgId),
  )
  if (!facts) return {}
  return facts.propertyName === null
    ? { goalName: facts.goalName }
    : { goalName: facts.goalName, propertyName: facts.propertyName }
}

/**
 * Facts for `badge.awarded`: which badge and which portal / portal group earned
 * it. `targetKind` is always known from the event, so even a dead lookup still
 * yields "A team earned a badge" rather than the raw definition UUID the old
 * handler pasted into the body.
 */
export const buildBadgePayload = async (
  deps: RecognitionPayloadDeps,
  input: Readonly<{
    badgeDefinitionId: BadgeId
    target: BadgeTarget
    orgId: OrganizationId
  }>,
): Promise<NotificationPayload> => {
  const facts = await attempt(deps.logger, 'badge facts', () =>
    deps.recognitionLookup.findBadgeFacts({
      badgeDefinitionId: input.badgeDefinitionId,
      target: input.target,
      orgId: input.orgId,
    }),
  )
  const payload: Record<string, unknown> = { targetKind: input.target.kind }
  if (facts) {
    payload.badgeName = facts.badgeName
    if (facts.recipientName !== null) payload.recipientName = facts.recipientName
  }
  return payload as NotificationPayload
}
