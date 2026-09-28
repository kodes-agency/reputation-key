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
// Inbox for escalations and Handling Cycles, Review for replies, Property and
// Portal for responsibility — never from Feed's own rows. It is freshness, not
// standing: whether the recipient may still be told is
// `notification-recipient-standing.ts`'s question.

import {
  inboxItemId,
  portalId,
  propertyId,
  reviewId,
  type InboxItemId,
  type OrganizationId,
} from '#/shared/domain/ids'
import type { NotificationType } from '../domain/notification-types'
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

export type NotificationWorkSubject = Readonly<{
  organizationId: OrganizationId
  type: NotificationType
  resourceId: string
  /** The audience the notice was queued under. */
  audience?: unknown
}>

/** `false`: the work is done. `true`: it still waits, or cannot be checked. */
export type NotificationWorkDecision = boolean

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
  'inbox.reopened': itemStillOpen,
  'inbox.response_target_halfway': itemStillOpen,
  'inbox.response_target_passed': itemStillOpen,
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
    const answers = await Promise.all(
      types.map((type) => check(deps, { organizationId, type, resourceId })),
    )
    return types.filter((_type, index) => {
      const answer = answers[index]
      return answer === null || answer === false
    })
  },
})
