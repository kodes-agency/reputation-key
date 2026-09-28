// Feed notification surface — whether the work a notice asks for still waits.
//
// Settlement retires the rows that exist when a settling fact is handled, and
// only those. A notice is written later, by the insert-notification job on the
// shared, rate-limited default queue, so an escalation resolved or a reply
// approved seconds after it was asked for could be settled before its notice
// existed: the late row then asked for work nobody was waiting on, urgent
// email included. And a row cannot say which request it stands for, so a
// settling fact handled late could retire a newer request that had coalesced
// into the same row, and cancel the only email asking for it.
//
// So the work itself is asked, per type, at the three moments that matter:
// before a notice is written, before its email leaves, and before a settling
// fact retires it. The answer comes from the context that owns the work — the
// Inbox for escalations and Handling Cycles, Review for replies, Portal for
// Health, Property and Portal for responsibility, Identity for the
// Organization lifecycle — never from Feed's own rows. It is freshness, not standing: whether the recipient may still be
// told is `notification-recipient-standing.ts`'s question.

import {
  inboxItemId,
  portalId,
  propertyId,
  reviewId,
  type InboxItemId,
  type OrganizationId,
} from '#/shared/domain/ids'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { Notification, NotificationType } from '../domain/notification-types'
import type { EscalationResolutionLookupPort } from './ports/escalation-resolution-lookup.port'
import type {
  HandlingCycleNotificationFacts,
  InboxItemLookupPort,
} from './ports/notification-inbox-item-lookup.port'
import type {
  ReplyWorkStateLookupPort,
  ReplyWorkStatus,
} from './ports/reply-work-state.port'
import type { ResponsibleManagerLookupPort } from './ports/responsible-manager-lookup.port'
import { isActionablePortalHealthReason } from './portal-health-notification'
import { parseNotificationAudience, type HandlingCycleRef } from './notification-audience'

export type NotificationWorkSubject = Readonly<{
  organizationId: OrganizationId
  type: NotificationType
  resourceId: string
  /**
   * The audience the notice was queued under. A grouped reopen's work is the
   * cycles its audience names; nothing else reads it.
   */
  audience?: unknown
}>

/**
 * `false`: the work is done. `true`: it still waits, or this type's work
 * cannot be checked. `{ itemCount }`: a grouped notice, and how many of its
 * items still wait.
 */
export type NotificationWorkDecision = boolean | Readonly<{ itemCount: number }>

export type NotificationWorkState = Readonly<{
  /** Asked before a notice is written and again before its email leaves. */
  isWaiting: (subject: NotificationWorkSubject) => Promise<NotificationWorkDecision>
  /**
   * Of the types a settling fact names, the ones it may retire now: their
   * work is done, or cannot be checked. A type whose work was asked for again
   * since the fact happened keeps its notice.
   */
  finished: (
    input: Readonly<{
      organizationId: OrganizationId
      resourceId: string
      types: ReadonlyArray<NotificationType>
    }>,
  ) => Promise<ReadonlyArray<NotificationType>>
}>

export type NotificationWorkStateDeps = Readonly<{
  escalationResolutions: EscalationResolutionLookupPort
  inboxItemLookup: Pick<InboxItemLookupPort, 'findHandlingCycleNotificationFacts'>
  replyStates: ReplyWorkStateLookupPort
  portalHealthLookup: Pick<PortalPublicApi, 'findPortalHealthNotificationFacts'>
  /** The Organization's lifecycle state; null when it has no lifecycle record. */
  organizationState: (organizationId: OrganizationId) => Promise<string | null>
  responsibleManagers: Pick<
    ResponsibleManagerLookupPort,
    'findForProperty' | 'findForPortal'
  >
}>

/** `null`: the owner could not say, so the notice is neither held nor retired. */
type WorkCheck = (
  deps: NotificationWorkStateDeps,
  subject: NotificationWorkSubject,
) => Promise<NotificationWorkDecision | null>

const cycleOf = (
  deps: NotificationWorkStateDeps,
  organizationId: OrganizationId,
  item: InboxItemId,
): Promise<HandlingCycleNotificationFacts | null> =>
  deps.inboxItemLookup.findHandlingCycleNotificationFacts(item, organizationId)

const stillEscalated: WorkCheck = async (deps, { organizationId, resourceId }) => {
  const facts = await deps.escalationResolutions.findEscalationResolutionFacts(
    inboxItemId(resourceId),
    organizationId,
  )
  return facts === null ? null : facts.isEscalated
}

/**
 * An item notice asks for its item to be handled; a closed head says it was.
 * An item with no head at all predates Handling Cycles and cannot tell.
 */
const itemStillOpen: WorkCheck = async (deps, { organizationId, resourceId }) => {
  const facts = await cycleOf(deps, organizationId, inboxItemId(resourceId))
  return facts === null ? null : facts.status === 'open'
}

/** A reply notice stands while the review's reply is still in `status`. */
const replyStill =
  (status: ReplyWorkStatus): WorkCheck =>
  async (deps, { organizationId, resourceId }) => {
    const facts = await cycleOf(deps, organizationId, inboxItemId(resourceId))
    if (facts === null) return null
    if (facts.sourceType !== 'review') return false
    const current = await deps.replyStates.findReplyStatus(
      reviewId(facts.sourceId),
      organizationId,
    )
    return current === status
  }

/** The cycle is still its item's exact open head: nobody has handled it since. */
export const isExactHead = (
  cycle: HandlingCycleRef,
  facts: HandlingCycleNotificationFacts | null,
): boolean =>
  facts !== null &&
  facts.sourceType === cycle.sourceType &&
  facts.sourceId === cycle.sourceId &&
  facts.currentCycleNumber === cycle.cycleNumber &&
  facts.currentSourceRevision === cycle.sourceRevision &&
  facts.stateRevision === cycle.stateRevision &&
  facts.status === 'open'

/**
 * A grouped reopen stands for the cycles its audience names, and counts only
 * those still their item's open head, so a mail sent hours later says how
 * many are really left.
 */
const groupStillOpen: WorkCheck = async (deps, { organizationId, audience }) => {
  const parsed = parseNotificationAudience(audience)
  if (parsed?.kind !== 'bulk_handling_cycle') return null
  const current = await Promise.all(
    parsed.cycles.map(async (cycle) =>
      isExactHead(cycle, await cycleOf(deps, organizationId, cycle.inboxItemId)),
    ),
  )
  const itemCount = current.filter(Boolean).length
  return itemCount === 0 ? false : { itemCount }
}

/**
 * Any Health interval that still gives a manager something to fix keeps the
 * notice: a different actionable reason is still the Portal needing them. A
 * Portal that is gone needs nobody.
 */
const healthStillNeedsAttention: WorkCheck = async (
  deps,
  { organizationId, resourceId },
) => {
  const facts = await deps.portalHealthLookup.findPortalHealthNotificationFacts(
    organizationId,
    portalId(resourceId),
  )
  if (facts === null) return false
  return facts.status !== 'healthy' && isActionablePortalHealthReason(facts.reason)
}

/** The final deletion warning is true only while the purge is still pending. */
const purgeStillPending: WorkCheck = async (deps, { organizationId }) => {
  const state = await deps.organizationState(organizationId)
  return state === null ? null : state === 'purge_pending'
}

const propertyStillUnstaffed: WorkCheck = async (deps, { organizationId, resourceId }) =>
  (await deps.responsibleManagers.findForProperty(organizationId, propertyId(resourceId)))
    .length === 0

const portalStillUnstaffed: WorkCheck = async (deps, { organizationId, resourceId }) =>
  (await deps.responsibleManagers.findForPortal(organizationId, portalId(resourceId)))
    .length === 0

/**
 * Every type whose work Feed can ask about. A type absent here reports news or
 * asks for work no owner answers for (a Google reconnect), and always passes.
 */
const WORK_CHECKS: Readonly<Partial<Record<NotificationType, WorkCheck>>> = {
  'inbox.escalated': stillEscalated,
  'reply.pending_approval': replyStill('pending_approval'),
  'reply.publish_failed': replyStill('publish_failed'),
  'review.created': itemStillOpen,
  'review.updated': itemStillOpen,
  'feedback.created': itemStillOpen,
  'inbox.reopened': itemStillOpen,
  'inbox.response_target_halfway': itemStillOpen,
  'inbox.response_target_passed': itemStillOpen,
  'inbox.bulk_reopened': groupStillOpen,
  'portal.health_attention': healthStillNeedsAttention,
  'account.organization_purge_pending': purgeStillPending,
  'property.responsibility_needed': propertyStillUnstaffed,
  'portal.responsibility_needed': portalStillUnstaffed,
}

const check = (
  deps: NotificationWorkStateDeps,
  subject: NotificationWorkSubject,
): Promise<NotificationWorkDecision | null> => {
  const ask = WORK_CHECKS[subject.type]
  return ask ? ask(deps, subject) : Promise.resolve(null)
}

export const createNotificationWorkState = (
  deps: NotificationWorkStateDeps,
): NotificationWorkState => ({
  isWaiting: async (subject) => (await check(deps, subject)) ?? true,
  finished: async ({ organizationId, resourceId, types }) => {
    // A closed cycle names six item types that all ask the same question of
    // the same item: ask each owner once per fact.
    const asked = new Map<WorkCheck, Promise<NotificationWorkDecision | null>>()
    const answerFor = (type: NotificationType) => {
      const ask = WORK_CHECKS[type]
      if (!ask) return Promise.resolve(null)
      const known = asked.get(ask)
      if (known) return known
      const answer = ask(deps, { organizationId, type, resourceId })
      asked.set(ask, answer)
      return answer
    }
    const answers = await Promise.all(types.map(answerFor))
    return types.filter((_type, index) => {
      const answer = answers[index]
      return answer === null || answer === false
    })
  },
})

/**
 * A grouped notice mailed hours after it was written says how many of its
 * items still wait, not how many its command touched.
 */
export const withStandingItemCount = (
  notification: Notification,
  work: NotificationWorkDecision,
): Notification =>
  typeof work === 'object'
    ? { ...notification, payload: { ...notification.payload, itemCount: work.itemCount } }
    : notification
