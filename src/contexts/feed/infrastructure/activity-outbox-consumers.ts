import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { auditEventFromFact } from '../audit/fact.server'
import {
  createOperationalActionRecord,
  type OperationalActionHistoryRecordId,
  type OperationalAction,
  type OperationalActionResourceType,
} from '../domain/operational-action-history'
import type { OperationalActionHistoryDeliveryStore } from '../ports/operational-action-history-store.port'
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
  clock: () => Date
  operationalHistoryDeliveryStore: OperationalActionHistoryDeliveryStore
  operationalHistoryIdGen: () => OperationalActionHistoryRecordId
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
  const audit = auditEventFromFact(event)
  const occurredAt = audit.occurredAt
  const observedAt = deps.clock()
  const recordedAt = observedAt.getTime() < occurredAt.getTime() ? occurredAt : observedAt
  const record = createOperationalActionRecord({
    id: deps.operationalHistoryIdGen(),
    organizationId: organizationId(audit.organizationId),
    propertyId: audit.propertyId === null ? null : propertyId(audit.propertyId),
    actorType: audit.actorType,
    actorId: audit.actorId,
    action: audit.action as OperationalAction,
    outcome: 'succeeded',
    resourceType: audit.resourceType as OperationalActionResourceType,
    resourceId: audit.resourceId,
    reasonCode: null,
    provenance: {
      kind: 'domain_fact',
      id: event.eventId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      sourceContext: event.sourceContext,
      sourceAggregateId: event.sourceAggregateId,
    },
    occurredAt,
    recordedAt,
  })
  if (record.isErr()) throw record.error
  const status = await deps.operationalHistoryDeliveryStore.applyOnce({
    record: record.value,
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
