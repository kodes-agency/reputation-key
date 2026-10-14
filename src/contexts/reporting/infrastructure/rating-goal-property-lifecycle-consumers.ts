// Reporting — ends a Property's Google rating goal when the Property is
// archived.
//
// A rating goal ends when its Property is archived (ADR 0067). Reads and the
// snapshot consumer already end it the first time they look, but snapshots
// stop while a Property is archived, so without this consumer a goal nobody
// opened would stay active through the archive and be ended on Restore as
// `google_location_changed` (Restore moves the binding epoch again).
//
// The fact names the epoch the archive moved the Property to; only a goal set
// under an earlier epoch ends, so a late or repeated delivery never ends a goal
// set after a Restore. The receipt follows the effect and is not in one
// transaction with it: a repeat after a crash finds no goal left to end and
// only adds the receipt. It runs ungated (its own catalogue row): a denied
// consumer is never retried, and a stop on `goal.use` must not leave the goal
// running on an archived Property.

import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import type { EndArchivedPropertyRatingGoal } from '../application/use-cases/rating-goals'

export const RATING_GOAL_PROPERTY_ARCHIVED_CONSUMER = 'goal.on-property-archived' as const

type PropertyArchivedPayload = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
}>

export type RatingGoalPropertyLifecycleConsumerDeps = Readonly<{
  endForArchivedProperty: EndArchivedPropertyRatingGoal
  db: Database
}>

function parsePropertyArchived(event: ConsumerEvent): PropertyArchivedPayload {
  if (event.eventType !== 'property.archived') {
    throw new Error('Rating goal archive consumer received the wrong event type')
  }
  const payload = validateEventPayload(
    'property.archived',
    event.eventVersion,
    event.payload,
  ) as PropertyArchivedPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Rating goal archive envelope attribution mismatch')
  }
  return payload
}

export const handleRatingGoalPropertyArchived = async (
  deps: RatingGoalPropertyLifecycleConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> => {
  const payload = parsePropertyArchived(event)
  await deps.endForArchivedProperty({
    organizationId: payload.organizationId,
    propertyId: payload.propertyId,
    archivedEpoch: payload.sourceEpoch,
  })
  await deps.db
    .insert(eventConsumerReceipts)
    .values({
      eventId: event.eventId,
      consumerName: RATING_GOAL_PROPERTY_ARCHIVED_CONSUMER,
      status: 'applied',
    })
    .onConflictDoNothing()
  return { status: 'applied' }
}

export const registerRatingGoalPropertyLifecycleConsumer = (
  registry: ConsumerRegistry,
  deps: RatingGoalPropertyLifecycleConsumerDeps,
): void => {
  const { registerConsumer } = registry
  // Literals kept mechanically discoverable by the governance catalogues.
  registerConsumer({
    eventType: 'property.archived',
    consumerName: 'goal.on-property-archived',
    module: 'goal.property-lifecycle',
    handler: (event) => handleRatingGoalPropertyArchived(deps, event),
  })
}
