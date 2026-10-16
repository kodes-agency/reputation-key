// Feed — the Property Google rating goal notices (ADR 0067 decision 6; ADR
// 0046, amended 2026-10-14).
//
// Reporting writes one `goal.rating_goal.transitioned` fact per notice, in the
// transaction that stores the change, and writes a change once. This route
// turns each fact into one notice per current responsible manager of the
// Property, AccountAdmins as the fallback — the resolver Goal notices use.
// Never staff: a Member is never a responsible manager.
//
// The fact carries the Property-level figures the notice states (the tenth
// Google shows, the goal's target and pace, and the recent pace of new
// reviews), never a review, a review's rating or an average of ratings. A
// repeated delivery converges on the same job ids, one per recipient, and on
// this consumer's receipt.

import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, propertyId, unbrand } from '#/shared/domain/ids'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import { resolveResponsibleRecipients } from '../application/responsible-recipients'
import type { NotificationPayload } from '../domain/notification-payload'
import type { NotificationType } from '../domain/notification-types'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'

export const ON_RATING_GOAL_TRANSITIONED_CONSUMER =
  'notification.on-rating-goal-transitioned' as const

const EVENT_TYPE = 'goal.rating_goal.transitioned' as const

export type RatingGoalNoticeConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    responsibleManagers: ResponsibleManagerLookupPort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type Transition =
  | 'reached'
  | 'google_rating_changed'
  | 'entered_below_pace'
  | 'entered_reviews_too_low'
  | 'keep_dropped_below'

type TransitionedPayload = Readonly<{
  organizationId: string
  propertyId: string
  goalId: string
  transition: Transition
  mode: 'climb' | 'keep'
  targetTenths: number
  shownTenths: number | null
  previousTenths: number | null
  pacePerWeek: number | null
  /** Absent from a fact written before the pace was kept in tenths. */
  paceTenthsPerWeek?: number | null
  recentPaceTenths: number | null
  paceWindow: 'last_4_weeks' | 'since_set' | 'since_pace_change' | null
}>

const NOTICE_TYPES: Readonly<Record<Transition, NotificationType>> = {
  reached: 'goal.rating_reached',
  google_rating_changed: 'goal.rating_changed',
  entered_below_pace: 'goal.rating_below_pace',
  entered_reviews_too_low: 'goal.rating_too_low',
  keep_dropped_below: 'goal.rating_keep_dropped',
}

function parse(event: ConsumerEvent): TransitionedPayload {
  if (event.eventType !== EVENT_TYPE) {
    throw new Error('Rating goal notice consumer received the wrong event type')
  }
  const payload = validateEventPayload(EVENT_TYPE, event.eventVersion, event.payload) as
    TransitionedPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Rating goal notice envelope attribution mismatch')
  }
  return payload
}

/** The figures the notice states, as the payload allowlist names them. */
function figuresOf(fact: TransitionedPayload): NotificationPayload {
  const figures: Readonly<Record<string, number | string | null>> = {
    ratingShownTenths: fact.shownTenths,
    ratingPreviousTenths: fact.previousTenths,
    ratingTargetTenths: fact.targetTenths,
    ratingGoalMode: fact.mode,
    ratingPacePerWeek: fact.pacePerWeek,
    ratingPaceTenthsPerWeek: fact.paceTenthsPerWeek ?? null,
    ratingRecentPaceTenths: fact.recentPaceTenths,
    ratingPaceWindow: fact.paceWindow,
  }
  return Object.fromEntries(
    Object.entries(figures).filter(([, value]) => value !== null),
  ) as NotificationPayload
}

export async function handleRatingGoalTransitioned(
  deps: RatingGoalNoticeConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const fact = parse(event)
  const organization = organizationId(fact.organizationId)
  const property = propertyId(fact.propertyId)
  // A system evaluation with no human actor: current responsibility for the
  // Property is the audience authority, and delivery asks it again.
  const scope = { kind: 'property', propertyId: fact.propertyId } as const
  const recipients = await resolveResponsibleRecipients(deps, organization, scope)
  const where = await buildPropertyPayload(deps, organization, property)
  const payload = { ...where, ...figuresOf(fact) }

  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: organization,
          propertyId: property,
          type: NOTICE_TYPES[fact.transition],
          // One row per (reader, type, goal): a later change of the same kind
          // meets the reader's unread row (ADR 0046 r.2).
          resourceType: 'goal' as const,
          resourceId: fact.goalId,
          eventId: event.eventId,
          payload,
          audience: { kind: 'responsible_scope', scope },
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_RATING_GOAL_TRANSITIONED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerRatingGoalNoticeConsumer(
  registry: ConsumerRegistry,
  deps: RatingGoalNoticeConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Literals kept mechanically discoverable by the governance catalogues.
  registerConsumer({
    eventType: 'goal.rating_goal.transitioned',
    consumerName: 'notification.on-rating-goal-transitioned',
    module: 'notification.rating-goal-notice-consumers',
    handler: (event) => handleRatingGoalTransitioned(deps, event),
  })
}
