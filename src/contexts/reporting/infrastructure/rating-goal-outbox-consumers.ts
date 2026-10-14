// Reporting — evaluates a Property's Google rating goal when Review has
// verified Google's numbers again.
//
// The fact only says when to look: the evaluation reads the current snapshot,
// the review cache and the Property itself, exactly as a page read does, so
// the order in which this and the snapshot consumer run does not matter (a
// look before the snapshot lands is repeated by the next fact or the next
// read). It reaches a goal Google now shows the target of, ends one whose
// Google location changed or whose Property was archived, and stores the
// tenth and status it saw.
//
// The receipt follows the evaluation and is not in one transaction with it:
// the evaluation writes only what changes the stored row, so a repeat after a
// crash finds nothing left to write and only adds the receipt.

import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import type { EvaluatePropertyRatingGoal } from '../application/use-cases/rating-goals'

export const RATING_GOAL_EVALUATION_CONSUMER = 'goal.google-rating-evaluation' as const

const EVENT_TYPE = 'review.google_reputation_snapshot.verified' as const

type VerifiedSnapshotPayload = Readonly<{ organizationId: string; propertyId: string }>

export type RatingGoalEvaluationConsumerDeps = Readonly<{
  evaluate: EvaluatePropertyRatingGoal
  db: Database
}>

function parseSnapshotFact(event: ConsumerEvent): VerifiedSnapshotPayload {
  if (event.eventType !== EVENT_TYPE) {
    throw new Error('Rating goal evaluation consumer received the wrong event type')
  }
  const payload = validateEventPayload(EVENT_TYPE, event.eventVersion, event.payload) as
    VerifiedSnapshotPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Rating goal evaluation envelope attribution mismatch')
  }
  return payload
}

export const handleRatingGoalEvaluation = async (
  deps: RatingGoalEvaluationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> => {
  const payload = parseSnapshotFact(event)
  await deps.evaluate(payload.organizationId, payload.propertyId)
  await deps.db
    .insert(eventConsumerReceipts)
    .values({
      eventId: event.eventId,
      consumerName: RATING_GOAL_EVALUATION_CONSUMER,
      status: 'applied',
    })
    .onConflictDoNothing()
  return { status: 'applied' }
}

export const registerRatingGoalEvaluationConsumer = (
  registry: ConsumerRegistry,
  deps: RatingGoalEvaluationConsumerDeps,
): void => {
  const { registerConsumer } = registry
  // Literals kept mechanically discoverable by the governance catalogues.
  registerConsumer({
    eventType: 'review.google_reputation_snapshot.verified',
    consumerName: 'goal.google-rating-evaluation',
    module: 'goal.google-rating-evaluation',
    handler: (event) => handleRatingGoalEvaluation(deps, event),
  })
}
