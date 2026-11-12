// Feed notification settlement — one policy for when a notice stops asking
// for work.
//
// Part 1: which notice types stand for waiting work and which facts retire them.
// Part 2: asking the owning context whether the work still waits (before a
// notice is written, before its email leaves, before a fact retires it).
// Part 3: grouped reopens, settled once none of their items still stands.
// Part 4: an assignment retired when its item moves to somebody else.
//
// docs/BETA.md says read is not resolved, so the work being done never marks a
// row read. It stamps `resolvedAt` instead.

import {
  inboxItemId,
  portalApprovedDestinationId,
  portalId,
  propertyId,
  reviewId,
  type InboxItemId,
  type NotificationId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { NotificationCategory, NotificationType } from '../domain/notification-types'
import type { EscalationResolutionLookupPort } from '../application/ports/escalation-resolution-lookup.port'
import type {
  HandlingCycleNotificationFacts,
  InboxItemLookupPort,
} from '../application/ports/notification-inbox-item-lookup.port'
import type {
  ReplyWorkStateLookupPort,
  ReplyWorkStatus,
} from '../application/ports/cross-context-lookups.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { NotificationRepositoryPort } from '../application/ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from '../application/ports/notification-email-repository.port'
import type {
  GroupedReopenStorePort,
  WaitingGroupedReopen,
} from '../application/ports/grouped-reopen-store.port'
import { isActionablePortalHealthReason } from '../application/portal-health-notification'
import {
  parseNotificationAudience,
  type HandlingCycleRef,
} from '../application/notification-audience'
import {
  isActionableNotificationType,
  RETRACTABLE_NOTIFICATION_TYPES,
  SETTLED_EMAIL_REASON,
  type NotificationWorkDecision,
} from '../domain/notification-actionable'
import type {
  NotificationWorkState,
  NotificationWorkSubject,
} from '../application/ports/notification-work-state.port'
import { isRecordPayload } from '../infrastructure/outbox-payload-fields'

/** Whether a settling fact may retire this type: work it asked for, or a warning taken back. */
export const isSettleableNotificationType = (type: NotificationType): boolean =>
  isActionableNotificationType(type) || RETRACTABLE_NOTIFICATION_TYPES.has(type)

/** The upstream facts that finish the work an actionable notice asked for. */
export type SettlingFact =
  | 'reply.decided'
  | 'reply.published'
  | 'reply.returned_to_draft'
  | 'escalation.resolved'
  | 'handling_cycle.closed'
  | 'property.responsibility_restored'
  | 'portal.responsibility_restored'
  | 'portal.destination_decided'
  | 'google_connection.reconnected'
  | 'google_connection.disconnected'
  | 'portal_health.recovered'
  | 'property.archived'

/**
 * A rejection settles the approval request as surely as an approval does:
 * either way nobody is waiting for the reader to decide any more. A
 * publication additionally settles an earlier failed one, because the retry
 * it asked for has now succeeded.
 */
const SETTLED_BY: Readonly<Record<SettlingFact, ReadonlyArray<NotificationType>>> = {
  'reply.decided': ['reply.pending_approval'],
  'reply.published': ['reply.pending_approval', 'reply.publish_failed'],
  // A cancelled publication puts the reply back in draft: there is nothing
  // left to retry, and "Reply returned to draft" says what happened instead.
  // Two causes also reach a reply that was still awaiting approval: a guest
  // edit returns it to draft (`source_changed`), and the AI draft purge
  // withdraws it (`ai_draft_withdrawn`). The approval request goes with
  // either: nothing is left for its reader to decide on. The other causes only
  // cancel a reply somebody already approved, so they meet no open request.
  // A fact handled late cannot retire a request made again since: the settling
  // consumer asks the work state first, and that reply is awaiting approval
  // again.
  'reply.returned_to_draft': ['reply.publish_failed', 'reply.pending_approval'],
  'escalation.resolved': ['inbox.escalated'],
  // A closed cycle is a handled item: its arrival, the reopen that asked for
  // it and every Response Target reminder about it are answered — whether it
  // was replied to, handled privately or withdrawn by the guest.
  // `inbox.bulk_reopened` is
  // absent here: one grouped notice stands for many items and is filed under
  // the first of them, so closing that one item must not retire a notice the
  // rest are still waiting behind. The same fact settles it by its own rule,
  // once none of its items still stands (`settleGroupedReopens` below).
  'handling_cycle.closed': [
    'review.created',
    'review.updated',
    'review.ai_urgent_detected',
    'feedback.created',
    'inbox.reopened',
    'inbox.response_target_halfway',
    'inbox.response_target_passed',
    'inbox.assigned',
  ],
  'property.responsibility_restored': ['property.responsibility_needed'],
  'portal.responsibility_restored': ['portal.responsibility_needed'],
  // Approved, turned off or held back: whichever it was, the site no longer
  // waits for anybody to decide it.
  'portal.destination_decided': ['portal.link_approval'],
  // A reconnect is the fix asked for. A deliberate disconnect answers it the
  // other way: the connection is gone on purpose, and asking every admin to
  // reconnect it would contradict the admin who removed it.
  'google_connection.reconnected': ['integration.reauthorization_required'],
  'google_connection.disconnected': ['integration.reauthorization_required'],
  // Health that recovered, or moved to a state nobody has to fix (a draft,
  // an archived Property), no longer needs the manager it asked.
  'portal_health.recovered': ['portal.health_attention'],
  // An archived Property is outside the workspace: nothing can be answered,
  // approved or published there, so every notice asking for work on it is
  // finished. This one fact settles by Property rather than by resource. A
  // Google reconnect request is absent: the connection is the
  // Organization's, and the Property only anchored its notice.
  'property.archived': [
    'review.created',
    'review.updated',
    'review.ai_urgent_detected',
    'feedback.created',
    'reply.pending_approval',
    'reply.publish_failed',
    'inbox.escalated',
    'inbox.reopened',
    'inbox.bulk_reopened',
    'inbox.response_target_halfway',
    'inbox.response_target_passed',
    'property.responsibility_needed',
    'portal.responsibility_needed',
    'portal.link_approval',
    'portal.health_attention',
    'inbox.assigned',
    'inbox.bulk_assigned',
  ],
}

/**
 * A notice that retires its own reader's earlier notices about the same item
 * when it is written — never anybody else's.
 *
 * An assignment takes over the ARRIVAL it hands to its assignee ("New review"
 * becomes "Assigned to you: review"), so the bell shows one row for one piece
 * of work. Only an arrival, and only its row in the app: a Low ratings notice
 * and unrated private feedback (Action needed) stay their own notices; an
 * email-only anchor was never in the bell; and the arrival's
 * email is cancelled only when the assignment sends one of its own, or the
 * reader would be left with no email about the item at all. It applies only
 * when the assignment is shown in the app, or the reader would be left with
 * nothing there.
 *
 * An item moving to somebody else retires its previous holder's "Assigned to
 * you" whatever their channels, email included: the work is no longer
 * waiting on them.
 */
export type SupersedeRule = Readonly<{
  types: ReadonlyArray<NotificationType>
  /** Only rows of these categories; null for any. */
  categories: ReadonlyArray<NotificationCategory> | null
  onlyWhenShownInApp: boolean
  /**
   * Retire only rows the reader still sees in the app — never an email-only
   * anchor — and cancel their email only when the new notice sends one.
   */
  keepsEmail: boolean
}>

export const SUPERSEDED_FOR_READER: Readonly<
  Partial<Record<NotificationType, SupersedeRule>>
> = {
  'inbox.assigned': {
    types: ['review.created', 'review.updated', 'feedback.created'],
    categories: ['arrivals'],
    onlyWhenShownInApp: true,
    keepsEmail: true,
  },
  'inbox.unassigned': {
    types: ['inbox.assigned'],
    categories: null,
    onlyWhenShownInApp: false,
    keepsEmail: false,
  },
}

export const settledNotificationTypes = (
  fact: SettlingFact,
): ReadonlyArray<NotificationType> => SETTLED_BY[fact]

export type NotificationWorkStateDeps = Readonly<{
  escalationResolutions: EscalationResolutionLookupPort
  inboxItemLookup: Pick<InboxItemLookupPort, 'findHandlingCycleNotificationFacts'>
  replyStates: ReplyWorkStateLookupPort
  portalHealthLookup: Pick<PortalPublicApi, 'findPortalHealthNotificationFacts'>
  /** Portal-owned: whether a site is still waiting for an account admin. */
  destinationLookup: Pick<PortalPublicApi, 'findDestinationApprovalNotificationFacts'>
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
 * A grouped assignment stands for the items its audience names, and counts
 * only those still open and still assigned to its recipient on the Property
 * it is filed under, so a mail sent later says how many are really left to
 * them. An item reassigned to a colleague is open but no longer theirs.
 */
const assignedItemsStillOpen: WorkCheck = async (
  deps,
  { organizationId, audience, recipient },
) => {
  const parsed = parseNotificationAudience(audience)
  if (parsed?.kind !== 'bulk_inbox_assignee' || recipient === undefined) return null
  const standing = await Promise.all(
    parsed.inboxItemIds.map(async (item) => {
      const facts = await cycleOf(deps, organizationId, item)
      return (
        facts?.status === 'open' &&
        facts.assignedTo === recipient.userId &&
        facts.propertyId === recipient.propertyId
      )
    }),
  )
  const itemCount = standing.filter(Boolean).length
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

/**
 * A site's notice stands while the site is still waiting for a decision and a
 * live Portal is left to decide it in: the route that raises the notice
 * announces no site without one, so a notice whose Portals are all gone is
 * retired the same way. A site that is gone (its Property was removed) has
 * nobody left to decide it.
 */
const destinationStillPending: WorkCheck = async (
  deps,
  { organizationId, resourceId },
) => {
  const facts = await deps.destinationLookup.findDestinationApprovalNotificationFacts(
    organizationId,
    portalApprovedDestinationId(resourceId),
  )
  return facts !== null && facts.approvalState === 'pending' && facts.portal !== null
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
  'review.ai_urgent_detected': itemStillOpen,
  'feedback.created': itemStillOpen,
  'inbox.reopened': itemStillOpen,
  'inbox.response_target_halfway': itemStillOpen,
  'inbox.response_target_passed': itemStillOpen,
  'inbox.bulk_reopened': groupStillOpen,
  'inbox.assigned': itemStillOpen,
  'inbox.bulk_assigned': assignedItemsStillOpen,
  'portal.health_attention': healthStillNeedsAttention,
  'portal.link_approval': destinationStillPending,
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

/** Deps whose item and reply reads are answered once per key for one batch. */
const memoizedReads = (deps: NotificationWorkStateDeps): NotificationWorkStateDeps => {
  const cycles = new Map<string, Promise<HandlingCycleNotificationFacts | null>>()
  const replies = new Map<string, ReturnType<typeof deps.replyStates.findReplyStatus>>()
  const once = <T>(cache: Map<string, T>, key: string, read: () => T): T => {
    const known = cache.get(key)
    if (known !== undefined) return known
    const answer = read()
    cache.set(key, answer)
    return answer
  }
  return {
    ...deps,
    inboxItemLookup: {
      findHandlingCycleNotificationFacts: (item, organizationId) =>
        once(cycles, `${organizationId}:${item}`, () =>
          deps.inboxItemLookup.findHandlingCycleNotificationFacts(item, organizationId),
        ),
    },
    replyStates: {
      ...deps.replyStates,
      findReplyStatus: (review, organizationId) =>
        once(replies, `${organizationId}:${review}`, () =>
          deps.replyStates.findReplyStatus(review, organizationId),
        ),
    },
  }
}

export const createNotificationWorkState = (
  deps: NotificationWorkStateDeps,
): NotificationWorkState => ({
  isWaiting: async (subject) => (await check(deps, subject)) ?? true,
  isWaitingMany: async (subjects) => {
    const reads = memoizedReads(deps)
    return Promise.all(
      subjects.map(async (subject) => (await check(reads, subject)) ?? true),
    )
  },
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

export type GroupedReopenSettlementDeps = Readonly<{
  groupedReopens: GroupedReopenStorePort
  emails: Pick<NotificationEmailRepositoryPort, 'cancelQueuedForNotifications'>
  workState: Pick<NotificationWorkState, 'isWaiting'>
}>

/**
 * The audience the grouped notice was queued under, rebuilt from its fact:
 * the cycles on this Property, the way the fan-out grouped them. `null` when
 * the fact does not have that shape; the gate then cannot judge the row, and
 * it stays as it stands.
 */
const groupedAudience = (
  source: unknown,
  propertyId: PropertyId,
): Readonly<{ first: string; audience: unknown }> | null => {
  if (!isRecordPayload(source) || !Array.isArray(source.reopened)) return null
  const cycles = source.reopened.flatMap((cycle: unknown) => {
    if (!isRecordPayload(cycle) || cycle.propertyId !== propertyId) return []
    const { propertyId: _property, ...ref } = cycle
    return [ref]
  })
  const first = cycles[0]?.inboxItemId
  if (typeof first !== 'string') return null
  return {
    first,
    audience: {
      kind: 'bulk_handling_cycle',
      cycles,
      actorUserId: typeof source.userId === 'string' ? source.userId : null,
    },
  }
}

/**
 * A finished row's id. A row a later grouped reopen
 * was folded into stands for items its first fact does not name, so it is
 * never judged by that fact alone.
 */
const finishedNotificationId = async (
  deps: GroupedReopenSettlementDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  row: WaitingGroupedReopen,
): Promise<NotificationId | null> => {
  if (row.coalescedCount > 1) return null
  const grouped = groupedAudience(row.source, propertyId)
  if (grouped === null) return null
  const work = await deps.workState.isWaiting({
    organizationId,
    type: 'inbox.bulk_reopened',
    resourceId: inboxItemId(grouped.first),
    audience: grouped.audience,
  })
  return work === false ? row.id : null
}

/** Settle the Property's grouped reopens with nothing left open; answers how many. */
export async function settleGroupedReopens(
  deps: GroupedReopenSettlementDeps,
  input: Readonly<{
    organizationId: OrganizationId
    propertyId: PropertyId
    resolvedAt: Date
  }>,
): Promise<number> {
  const waiting = await deps.groupedReopens.findWaiting({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
  })
  const candidates = await Promise.all(
    waiting.map((row) =>
      finishedNotificationId(deps, input.organizationId, input.propertyId, row),
    ),
  )
  const finished = candidates.filter((id): id is NotificationId => id !== null)
  if (finished.length === 0) return 0

  const settled = await deps.groupedReopens.settle({
    organizationId: input.organizationId,
    ids: finished,
    resolvedAt: input.resolvedAt,
  })
  if (settled.length > 0) {
    await deps.emails.cancelQueuedForNotifications(
      settled,
      input.organizationId,
      SETTLED_EMAIL_REASON,
      input.resolvedAt,
    )
  }
  return settled.length
}

export type RetireMovedAssignmentDeps = Readonly<{
  notifications: Pick<NotificationRepositoryPort, 'settleUnreadForReader'>
  emails: Pick<NotificationEmailRepositoryPort, 'cancelQueuedForNotifications'>
}>

export type RetireMovedAssignment = (
  input: Readonly<{
    organizationId: OrganizationId
    /** Who held the item before it moved. */
    userId: UserId
    inboxItemId: InboxItemId
    eventId: string
    at: Date
  }>,
) => Promise<void>

export const createRetireMovedAssignment =
  (deps: RetireMovedAssignmentDeps): RetireMovedAssignment =>
  async ({ organizationId, userId, inboxItemId, eventId, at }) => {
    const settled = await deps.notifications.settleUnreadForReader({
      organizationId,
      userId,
      types: ['inbox.assigned'],
      resourceId: inboxItemId,
      supersededByEventId: eventId,
      resolvedAt: at,
    })
    if (settled.length === 0) return
    await deps.emails.cancelQueuedForNotifications(
      settled,
      organizationId,
      SETTLED_EMAIL_REASON,
      at,
    )
  }
