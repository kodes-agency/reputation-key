import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { isOperatorActorId } from '#/shared/domain/operator-actor'
import {
  createOperationalActionRecord,
  type OperationalAction,
  type OperationalActionActorType,
  type OperationalActionHistoryRecordId,
  type OperationalActionResourceType,
} from '../domain/operational-action-history'
import type { OperationalActionHistoryDeliveryStore } from '../ports/operational-action-history-store.port'
import {
  optionalString,
  stringValue,
  type ActivityFactPayload as Payload,
} from './activity-fact-fields'
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

/** The fact's actor when an operator (`ops:<handle>`) did it, not a person. */
const operatorActorOf = (payload: Payload): string | null => {
  const value = optionalString(payload, 'userId')
  return value !== null && isOperatorActorId(value) ? value : null
}

const occurrenceTime = (event: ConsumerEvent, payload: Payload): Date => {
  const value = payload.occurredAt ?? event.occurredAt ?? event.recordedAt
  const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Operational Action History durable fact has no valid source time')
  }
  return date
}

const scope = (event: ConsumerEvent, payload: Payload) => {
  const org = stringValue(payload, 'organizationId')
  if (org !== event.organizationId) {
    throw new Error('Operational Action History fact Organization attribution mismatch')
  }
  const payloadProperty = optionalString(payload, 'propertyId')
  if (payloadProperty !== null && payloadProperty !== event.propertyId) {
    throw new Error('Operational Action History fact Property attribution mismatch')
  }
  return {
    organizationId: organizationId(org),
    propertyId: payloadProperty ? propertyId(payloadProperty) : null,
  }
}

type OperationalActionProjection = Readonly<{
  actorType: OperationalActionActorType
  actorId: string | null
  action: OperationalAction
  resourceType: OperationalActionResourceType
  resourceId: string
}>

const operationalActionProjection = (
  event: ConsumerEvent,
  payload: Payload,
): OperationalActionProjection => {
  switch (event.eventType) {
    case 'identity.member.role_changed':
      return {
        actorType: 'user',
        actorId: stringValue(payload, 'userId'),
        action: 'member.role_changed',
        resourceType: 'member',
        resourceId: stringValue(payload, 'memberUserId'),
      }
    case 'identity.merchant_ai.changed': {
      const property = stringValue(payload, 'propertyId')
      return {
        actorType: 'system',
        actorId: null,
        action: 'capability.changed',
        resourceType: 'capability',
        resourceId: `merchant_ai:${property}`,
      }
    }
    case 'integration.google_account.connected':
      return {
        actorType: 'user',
        actorId: stringValue(
          payload,
          event.eventVersion === 2 ? 'connectedBy' : 'userId',
        ),
        action: 'google_connection.connected',
        resourceType: 'google_connection',
        resourceId: stringValue(payload, 'connectionId'),
      }
    case 'integration.google_account.disconnected': {
      // The AccountAdmin who disconnected; absent for a disconnect the recovery
      // reconciler cannot attribute and for facts older than the field.
      const actorId = optionalString(payload, 'userId')
      return {
        actorType: actorId === null ? 'system' : 'user',
        actorId,
        action: 'google_connection.disconnected',
        resourceType: 'google_connection',
        resourceId: stringValue(payload, 'connectionId'),
      }
    }
    case 'portal.publication.published': {
      const operatorId = operatorActorOf(payload)
      return {
        actorType: operatorId === null ? 'user' : 'operator',
        actorId: operatorId ?? stringValue(payload, 'userId'),
        action: 'portal.published',
        resourceType: 'portal',
        resourceId: stringValue(payload, 'portalId'),
      }
    }
    case 'portal.archived':
      return {
        actorType: 'user',
        actorId: stringValue(payload, 'userId'),
        action: 'portal.archived',
        resourceType: 'portal',
        resourceId: stringValue(payload, 'portalId'),
      }
    case 'portal.approved_destination.updated':
      return {
        actorType: 'system',
        actorId: null,
        action: 'policy.changed',
        resourceType: 'policy',
        resourceId: stringValue(payload, 'approvedDestinationId'),
      }
    case 'property.archived':
    case 'property.restored':
      return {
        actorType: 'user',
        actorId: stringValue(payload, 'userId'),
        action: event.eventType,
        resourceType: 'property',
        resourceId: stringValue(payload, 'propertyId'),
      }
    case 'property.deleted':
      return {
        actorType: 'system',
        actorId: null,
        action: 'property.deleted',
        resourceType: 'property',
        resourceId: stringValue(payload, 'propertyId'),
      }
    case 'review.reply.published': {
      const actorId = optionalString(payload, 'authorId')
      return {
        actorType: actorId === null ? 'system' : 'user',
        actorId,
        action: 'google_reply.published',
        resourceType: 'reply',
        resourceId: stringValue(payload, 'replyId'),
      }
    }
    default:
      throw new Error(`Unsupported Operational Action History fact: ${event.eventType}`)
  }
}

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
  const validated = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  )
  if (typeof validated !== 'object' || validated === null || Array.isArray(validated)) {
    throw new Error('Operational Action History durable fact payload is invalid')
  }
  const payload = validated as Payload
  const eventScope = scope(event, payload)
  const projection = operationalActionProjection(event, payload)
  if (event.sourceContext.length === 0 || event.sourceAggregateId.length === 0) {
    throw new Error('Operational Action History source identity is incomplete')
  }
  const occurredAt = occurrenceTime(event, payload)
  const observedAt = deps.clock()
  const recordedAt = observedAt.getTime() < occurredAt.getTime() ? occurredAt : observedAt
  const record = createOperationalActionRecord({
    id: deps.operationalHistoryIdGen(),
    organizationId: eventScope.organizationId,
    propertyId: eventScope.propertyId,
    actorType: projection.actorType,
    actorId: projection.actorId,
    action: projection.action,
    outcome: 'succeeded',
    resourceType: projection.resourceType,
    resourceId: projection.resourceId,
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
