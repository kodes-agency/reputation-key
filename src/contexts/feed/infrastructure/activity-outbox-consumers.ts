import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import { auditEventFromFact } from '../audit/fact.server'
import type { AuditDeliveryStore } from '../audit/deliver.server'
export const ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER =
  'activity.operational-action-history'

export const DURABLE_OPERATIONAL_ACTION_HISTORY_EVENT_TYPES = Object.freeze([
  'identity.member.role_changed',
  'identity.merchant_ai.changed',
  'integration.google_account.connected',
  'integration.google_account.disconnected',
  'portal.archived',
  'portal.approved_destination.updated',
  'portal.publication.published',
  'property.archived',
  'property.deleted',
  'property.restored',
  'review.reply.published',
] as const)

export type ActivityOutboxConsumerDeps = Readonly<{
  auditDeliveryStore: AuditDeliveryStore
}>

export const handleOperationalActionHistoryFact = async (
  deps: ActivityOutboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> => {
  if (
    !DURABLE_OPERATIONAL_ACTION_HISTORY_EVENT_TYPES.includes(
      event.eventType as (typeof DURABLE_OPERATIONAL_ACTION_HISTORY_EVENT_TYPES)[number],
    )
  ) {
    throw new Error(`Unsupported Operational Action History fact: ${event.eventType}`)
  }
  const status = await deps.auditDeliveryStore.applyOnce({
    event: auditEventFromFact(event),
    eventId: event.eventId,
    consumerName: ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER,
  })
  return { status }
}

export const registerActivityOutboxConsumers = (
  registry: ConsumerRegistry,
  deps: ActivityOutboxConsumerDeps,
): void => {
  const { registerConsumer } = registry
  for (const eventType of DURABLE_OPERATIONAL_ACTION_HISTORY_EVENT_TYPES) {
    registerConsumer({
      eventType,
      consumerName: ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER,
      module: 'activity.outbox-consumers',
      handler: (event) => handleOperationalActionHistoryFact(deps, event),
    })
  }
}
