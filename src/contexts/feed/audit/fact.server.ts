import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent } from '#/shared/outbox'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { isOperatorActorId } from '#/shared/domain/operator-actor'
import { parseAuditEvent, type AuditEvent } from './event.server'

type Payload = Readonly<Record<string, unknown>>

const stringValue = (payload: Payload, key: string): string => {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Operational Action History fact ${key} is invalid`)
  }
  return value
}

const optionalString = (payload: Payload, key: string): string | null => {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

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

type AuditProjection = Readonly<{
  actorType: AuditEvent['actorType']
  actorId: string | null
  action: AuditEvent['action']
  resourceType: AuditEvent['resourceType']
  resourceId: string
}>

const projectAuditAction = (event: ConsumerEvent, payload: Payload): AuditProjection => {
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

export const auditEventFromFact = (event: ConsumerEvent): AuditEvent => {
  const validated = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  )
  if (typeof validated !== 'object' || validated === null || Array.isArray(validated)) {
    throw new Error('Audit fact payload is invalid')
  }
  const payload = validated as Payload
  const eventScope = scope(event, payload)
  const projection = projectAuditAction(event, payload)
  return parseAuditEvent({
    ...eventScope,
    ...projection,
    outcome: 'succeeded',
    sourceKind: 'domain_fact',
    sourceId: event.eventId,
    sourceEventType: event.eventType,
    sourceEventVersion: event.eventVersion,
    sourceContext: event.sourceContext,
    sourceAggregateId: event.sourceAggregateId,
    occurredAt: occurrenceTime(event, payload),
  })
}
