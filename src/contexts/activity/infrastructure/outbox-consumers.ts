import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, ConsumerResult } from '#/shared/outbox'
import {
  organizationId,
  propertyId,
  userId,
  type RecentActivityEntryId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../ports/user-lookup.port'
import type { InboxItemLookupPort } from '../ports/inbox-item-lookup.port'
import {
  ACTIVITY_RECENT_ACTIVITY_CONSUMER,
  type ActivityDeliveryStore,
} from '../ports/activity-delivery-store.port'
import {
  prepareRecentActivityEntry,
  type ProjectRecentActivityInput,
} from '../application/use-cases/project-recent-activity'
import {
  createObsoleteRecentActivityReplayFact,
  createProjectableRecentActivityReplayFact,
} from '../domain/recent-activity-replay-fact'
import {
  createOperationalActionRecord,
  type OperationalAction,
  type OperationalActionActorType,
  type OperationalActionHistoryRecordId,
  type OperationalActionResourceType,
} from '../domain/operational-action-history'
import type { OperationalActionHistoryDeliveryStore } from '../ports/operational-action-history-store.port'

export { ACTIVITY_RECENT_ACTIVITY_CONSUMER }

export const ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER =
  'activity.operational-action-history'

export const DURABLE_RECENT_ACTIVITY_EVENT_TYPES = Object.freeze([
  'goal.monthly_result.closed',
  'goal.monthly_result.reconciled',
  'goal.monthly_result.revised',
  'identity.invitation.accepted',
  'identity.invitation.canceled',
  'identity.member.invited',
  'identity.member.removed',
  'identity.member.role_changed',
  'identity.organization.created',
  'inbox.inbox_item.assigned',
  'inbox.inbox_item.bulk_status_changed',
  'inbox.inbox_item.created',
  'inbox.inbox_item.escalated',
  'inbox.inbox_item.escalation_resolved',
  'inbox.inbox_item.status_changed',
  'inbox.inbox_item.unassigned',
  'inbox.inbox_note.added',
  'integration.google_account.connected',
  'integration.google_account.disconnected',
  'integration.google_connection.visibility_changed',
  'portal.archived',
  'portal.health.changed',
  'portal.publication.published',
  'portal.publication.rolled_back',
  'portal.restored',
  'property.created',
  'property.deleted',
  'property.archived',
  'property.restored',
  'property.updated',
  'review.reply.approved',
  'review.reply.publication_cancelled',
  'review.reply.published',
  'review.reply.rejected',
  'review.reply.submitted',
  'review.reply.updated',
] as const)

export const DURABLE_OPERATIONAL_ACTION_HISTORY_EVENT_TYPES = Object.freeze([
  'identity.member.role_changed',
  'identity.merchant_ai.changed',
  'integration.google_account.connected',
  'integration.google_account.disconnected',
  'portal.archived',
  'portal.approved_destination.updated',
  'portal.hero_image.published',
  'portal.publication.published',
  'property.archived',
  'property.deleted',
  'property.restored',
  'review.reply.published',
] as const)

export type ActivityOutboxConsumerDeps = Readonly<{
  deliveryStore: ActivityDeliveryStore
  userLookup: UserLookupPort
  inboxItemLookup: InboxItemLookupPort
  clock: () => Date
  logger: LoggerPort
  idGen: () => RecentActivityEntryId
  operationalHistoryDeliveryStore: OperationalActionHistoryDeliveryStore
  operationalHistoryIdGen: () => OperationalActionHistoryRecordId
}>

type Payload = Readonly<Record<string, unknown>>

const stringValue = (payload: Payload, key: string): string => {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Recent Activity fact ${key} is invalid`)
  }
  return value
}

const optionalString = (payload: Payload, key: string): string | null => {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const occurrenceTime = (event: ConsumerEvent, payload: Payload): Date => {
  const value = payload.occurredAt ?? event.occurredAt ?? event.recordedAt
  const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Recent Activity durable fact has no valid source time')
  }
  return date
}

const sourceValue = (payload: Payload): 'web' | 'import' =>
  payload.source === 'import' ? 'import' : 'web'

const scope = (event: ConsumerEvent, payload: Payload) => {
  const org = stringValue(payload, 'organizationId')
  if (org !== event.organizationId) {
    throw new Error('Recent Activity fact Organization attribution mismatch')
  }
  const payloadProperty = optionalString(payload, 'propertyId')
  if (payloadProperty !== null && payloadProperty !== event.propertyId) {
    throw new Error('Recent Activity fact Property attribution mismatch')
  }
  return {
    organizationId: organizationId(org),
    propertyId: payloadProperty ? propertyId(payloadProperty) : null,
  }
}

const goalPayloadWithEnvelopeScope = (
  event: ConsumerEvent,
  payload: Payload,
): Payload => {
  if (!event.propertyId) {
    throw new Error('Recent Activity Goal fact has no Property attribution')
  }
  return {
    ...payload,
    organizationId: optionalString(payload, 'organizationId') ?? event.organizationId,
    propertyId: optionalString(payload, 'propertyId') ?? event.propertyId,
  }
}

const goalOutcome = (payload: Payload): string => {
  const achieved = payload.achieved
  if (achieved === true) return 'achieved'
  if (achieved === false) return 'not_achieved'
  return stringValue(payload, 'evaluationState')
}

const goalRevisionDetail = (payload: Payload): string => {
  const outcomeChanged = payload.outcomeChanged === true
  const availabilityChanged = payload.availabilityChanged === true
  if (outcomeChanged && availabilityChanged) {
    return 'outcome_and_availability_changed'
  }
  if (outcomeChanged) return 'outcome_changed'
  if (availabilityChanged) return 'availability_changed'
  return 'revision_recorded'
}

const activityInput = (
  event: ConsumerEvent,
  payload: Payload,
  fields: Omit<
    ProjectRecentActivityInput,
    'organizationId' | 'propertyId' | 'eventId' | 'occurredAt'
  >,
): ProjectRecentActivityInput => ({
  ...scope(event, payload),
  ...fields,
  eventId: event.eventId,
  occurredAt: occurrenceTime(event, payload),
})

const replyInput = async (
  deps: ActivityOutboxConsumerDeps,
  event: ConsumerEvent,
  payload: Payload,
  action: ProjectRecentActivityInput['action'],
  transition: Readonly<{
    from?: string | null
    to?: string | null
    detail?: string | null
  }> = {},
): Promise<ProjectRecentActivityInput | null> => {
  // Validate tenant/Property attribution before any obsolete settlement. A
  // missing lookup must never bypass the envelope/payload scope fence.
  scope(event, payload)
  const reviewId = stringValue(payload, 'reviewId')
  const inboxItemId = await deps.inboxItemLookup.findBySourceId(
    reviewId,
    event.organizationId,
  )
  if (!inboxItemId) return null
  return activityInput(event, payload, {
    action,
    resourceType: 'reply',
    resourceId: stringValue(payload, 'replyId'),
    userId: optionalString(payload, 'userId')
      ? userId(optionalString(payload, 'userId')!)
      : null,
    source: sourceValue(payload),
    payload: {
      subject: 'reply',
      from: transition.from ?? null,
      to: transition.to ?? null,
      detail: transition.detail ?? null,
    },
  })
}

const mapRecentActivityFact = async (
  deps: ActivityOutboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ProjectRecentActivityInput | null> => {
  const validated = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  )
  if (typeof validated !== 'object' || validated === null || Array.isArray(validated)) {
    throw new Error('Recent Activity durable fact payload is invalid')
  }
  const payload = validated as Payload
  const actor = (key = 'userId') => {
    const value = optionalString(payload, key)
    return value ? userId(value) : null
  }
  const inbox = (
    action: ProjectRecentActivityInput['action'],
    subject: string,
    transition: Readonly<{
      from?: string | null
      to?: string | null
      detail?: string | null
      bulkId?: string
    }> = {},
  ) =>
    activityInput(event, payload, {
      action,
      resourceType: 'inbox_item',
      resourceId: stringValue(payload, 'inboxItemId'),
      userId: actor(),
      source: sourceValue(payload),
      payload: {
        subject,
        from: transition.from ?? null,
        to: transition.to ?? null,
        detail: transition.detail ?? null,
        ...(transition.bulkId ? { bulkId: transition.bulkId } : {}),
      },
    })

  switch (event.eventType) {
    case 'property.created':
      return activityInput(event, payload, {
        action: 'created',
        resourceType: 'property',
        resourceId: stringValue(payload, 'propertyId'),
        userId: null,
        source: 'web',
        payload: { subject: 'property', from: null, to: null, detail: null },
      })
    case 'property.updated':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'property',
        resourceId: stringValue(payload, 'propertyId'),
        userId: null,
        source: 'web',
        payload: { subject: 'property', from: null, to: null, detail: null },
      })
    case 'property.deleted':
      return activityInput(event, payload, {
        action: 'deleted',
        resourceType: 'property',
        resourceId: stringValue(payload, 'propertyId'),
        userId: null,
        source: 'web',
        payload: { subject: 'property', from: null, to: null, detail: null },
      })
    case 'property.archived':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'property',
        resourceId: stringValue(payload, 'propertyId'),
        userId: actor(),
        source: 'web',
        payload: {
          subject: 'property',
          from: stringValue(payload, 'previousState'),
          to: 'archived',
          detail: null,
        },
      })
    case 'property.restored':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'property',
        resourceId: stringValue(payload, 'propertyId'),
        userId: actor(),
        source: 'web',
        payload: {
          subject: 'property',
          from: stringValue(payload, 'previousState'),
          to: 'active',
          detail: null,
        },
      })
    case 'identity.organization.created':
      return activityInput(event, payload, {
        action: 'created',
        resourceType: 'organization',
        resourceId: stringValue(payload, 'organizationId'),
        userId: userId(stringValue(payload, 'ownerId')),
        source: 'web',
        payload: { subject: 'organization', from: null, to: null, detail: null },
      })
    case 'identity.member.invited':
      return activityInput(event, payload, {
        action: 'invited',
        resourceType: 'member',
        resourceId: stringValue(payload, 'invitationId'),
        userId: null,
        source: 'web',
        payload: {
          subject: 'member',
          from: null,
          to: stringValue(payload, 'role'),
          detail: null,
        },
      })
    case 'identity.invitation.accepted':
      return activityInput(event, payload, {
        action: 'added',
        resourceType: 'member',
        resourceId: stringValue(payload, 'invitationId'),
        userId: actor(),
        source: 'web',
        payload: { subject: 'member', from: null, to: null, detail: null },
      })
    case 'identity.invitation.canceled':
      return activityInput(event, payload, {
        action: 'deleted',
        resourceType: 'member',
        resourceId: stringValue(payload, 'invitationId'),
        userId: null,
        source: 'web',
        payload: { subject: 'member', from: null, to: null, detail: null },
      })
    case 'identity.member.removed':
      return activityInput(event, payload, {
        action: 'deleted',
        resourceType: 'member',
        resourceId: stringValue(payload, 'userId'),
        userId: null,
        source: 'web',
        payload: { subject: 'member', from: null, to: null, detail: null },
      })
    case 'identity.member.role_changed':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'member',
        resourceId: stringValue(payload, 'memberUserId'),
        userId: actor(),
        source: 'web',
        payload: {
          subject: 'member',
          from: stringValue(payload, 'previousRole'),
          to: stringValue(payload, 'newRole'),
          detail: null,
        },
      })
    case 'integration.google_account.connected':
      return activityInput(event, payload, {
        action: 'connected',
        resourceType: 'integration',
        resourceId: stringValue(payload, 'connectionId'),
        userId: actor(event.eventVersion === 2 ? 'connectedBy' : 'userId'),
        source: 'web',
        payload: { subject: 'integration', from: null, to: null, detail: null },
      })
    case 'integration.google_account.disconnected':
      return activityInput(event, payload, {
        action: 'disconnected',
        resourceType: 'integration',
        resourceId: stringValue(payload, 'connectionId'),
        userId: null,
        source: 'web',
        payload: { subject: 'integration', from: null, to: null, detail: null },
      })
    case 'integration.google_connection.visibility_changed':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'integration',
        resourceId: stringValue(payload, 'connectionId'),
        userId: null,
        source: 'web',
        payload: {
          subject: 'integration',
          from: null,
          to: stringValue(payload, 'visibility'),
          detail: null,
        },
      })
    case 'portal.publication.published':
      return activityInput(event, payload, {
        action: 'published',
        resourceType: 'portal',
        resourceId: stringValue(payload, 'portalId'),
        userId: actor(),
        source: 'web',
        payload: {
          subject: 'portal_publication',
          from: null,
          to: 'published',
          detail: null,
        },
      })
    case 'portal.publication.rolled_back':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'portal',
        resourceId: stringValue(payload, 'portalId'),
        userId: actor(),
        source: 'web',
        payload: {
          subject: 'portal_publication',
          from: null,
          to: 'rolled_back',
          detail: null,
        },
      })
    case 'portal.archived':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'portal',
        resourceId: stringValue(payload, 'portalId'),
        userId: actor(),
        source: 'web',
        payload: { subject: 'portal', from: null, to: 'archived', detail: null },
      })
    case 'portal.restored':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'portal',
        resourceId: stringValue(payload, 'portalId'),
        userId: actor(),
        source: 'web',
        payload: {
          subject: 'portal',
          from: 'archived',
          to: 'disabled',
          detail: null,
        },
      })
    case 'portal.health.changed':
      return activityInput(event, payload, {
        action: 'changed',
        resourceType: 'portal',
        resourceId: stringValue(payload, 'portalId'),
        userId: null,
        source: 'web',
        payload: {
          subject: 'portal_health',
          from: `${stringValue(payload, 'previousStatus')}:${stringValue(payload, 'previousReason')}`,
          to: `${stringValue(payload, 'status')}:${stringValue(payload, 'reason')}`,
          detail: null,
        },
      })
    case 'goal.monthly_result.closed': {
      const goalPayload = goalPayloadWithEnvelopeScope(event, payload)
      return activityInput(event, goalPayload, {
        action: 'changed',
        resourceType: 'goal',
        resourceId: stringValue(goalPayload, 'monthlyResultId'),
        userId: null,
        source: 'web',
        payload: {
          subject: 'goal_result',
          from: null,
          to: goalOutcome(goalPayload),
          detail: stringValue(goalPayload, 'evaluationState'),
        },
      })
    }
    case 'goal.monthly_result.reconciled': {
      const goalPayload = goalPayloadWithEnvelopeScope(event, payload)
      return activityInput(event, goalPayload, {
        action: 'changed',
        resourceType: 'goal',
        resourceId: stringValue(goalPayload, 'monthlyResultId'),
        userId: null,
        source: 'web',
        payload: {
          subject: 'goal_result',
          from: null,
          to: 'reconciling',
          detail: stringValue(goalPayload, 'evaluationState'),
        },
      })
    }
    case 'goal.monthly_result.revised': {
      const goalPayload = goalPayloadWithEnvelopeScope(event, payload)
      return activityInput(event, goalPayload, {
        action: 'changed',
        resourceType: 'goal',
        resourceId: stringValue(goalPayload, 'monthlyResultId'),
        userId: null,
        source: 'web',
        payload: {
          subject: 'goal_result',
          from: null,
          to: goalOutcome(goalPayload),
          detail: goalRevisionDetail(goalPayload),
        },
      })
    }
    case 'inbox.inbox_item.created':
      return inbox('created', 'inbox_item', {
        detail: optionalString(payload, 'sourceType'),
      })
    case 'inbox.inbox_item.status_changed':
      return inbox('changed', 'status', {
        from: stringValue(payload, 'oldStatus'),
        to: stringValue(payload, 'newStatus'),
      })
    case 'inbox.inbox_item.escalated':
      return inbox('escalated', 'escalation', { to: 'flagged' })
    case 'inbox.inbox_item.escalation_resolved':
      return inbox('deescalated', 'escalation', {
        from: 'flagged',
        to: 'resolved',
      })
    case 'inbox.inbox_item.assigned':
      return inbox('assigned', 'inbox_item', {
        to: stringValue(payload, 'assignedTo'),
      })
    case 'inbox.inbox_item.unassigned':
      return inbox('unassigned', 'inbox_item', {
        from: stringValue(payload, 'previousAssignee'),
      })
    case 'inbox.inbox_note.added':
      return inbox('added', 'note')
    case 'inbox.inbox_item.bulk_status_changed':
      return inbox('changed', 'status', {
        from: stringValue(payload, 'oldStatus'),
        to: stringValue(payload, 'newStatus'),
        bulkId: stringValue(payload, 'bulkId'),
      })
    case 'review.reply.submitted':
      return replyInput(deps, event, payload, 'submitted')
    case 'review.reply.approved':
      return replyInput(deps, event, payload, 'approved')
    case 'review.reply.rejected':
      return replyInput(deps, event, payload, 'rejected')
    case 'review.reply.published':
      return replyInput(deps, event, payload, 'published')
    case 'review.reply.updated':
      return replyInput(deps, event, payload, 'changed', {
        from: 'published',
        to: 'approved',
        detail: 'edited_for_republish',
      })
    case 'review.reply.publication_cancelled':
      return replyInput(deps, event, payload, 'changed', {
        to: 'draft',
        detail: `publication_cancelled:${stringValue(payload, 'cause')}`,
      })
    default:
      throw new Error(`Unsupported durable Recent Activity fact: ${event.eventType}`)
  }
}

export const handleRecentActivityFact = async (
  deps: ActivityOutboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> => {
  const input = await mapRecentActivityFact(deps, event)
  if (input === null) {
    await deps.deliveryStore.recordObsolete({
      replayFact: createObsoleteRecentActivityReplayFact(event),
      eventId: event.eventId,
      consumerName: ACTIVITY_RECENT_ACTIVITY_CONSUMER,
    })
    return { status: 'obsolete' }
  }

  const prepared = await prepareRecentActivityEntry(deps, input)
  if (prepared.isErr()) throw prepared.error
  const status = await deps.deliveryStore.applyOnce({
    entry: prepared.value,
    replayFact: createProjectableRecentActivityReplayFact(
      event,
      input,
      prepared.value.id,
    ),
    eventId: event.eventId,
    consumerName: ACTIVITY_RECENT_ACTIVITY_CONSUMER,
  })
  return { status }
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
    case 'integration.google_account.disconnected':
      return {
        actorType: 'system',
        actorId: null,
        action: 'google_connection.disconnected',
        resourceType: 'google_connection',
        resourceId: stringValue(payload, 'connectionId'),
      }
    case 'portal.publication.published':
      return {
        actorType: 'user',
        actorId: stringValue(payload, 'userId'),
        action: 'portal.published',
        resourceType: 'portal',
        resourceId: stringValue(payload, 'portalId'),
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
    case 'portal.hero_image.published':
      return {
        actorType: 'system',
        actorId: null,
        action: 'portal_upload.validated',
        resourceType: 'upload',
        resourceId: stringValue(payload, 'uploadId'),
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
  for (const eventType of DURABLE_RECENT_ACTIVITY_EVENT_TYPES) {
    registerConsumer({
      eventType,
      consumerName: ACTIVITY_RECENT_ACTIVITY_CONSUMER,
      module: 'activity.outbox-consumers',
      handler: (event) => handleRecentActivityFact(deps, event),
    })
  }
  for (const eventType of DURABLE_OPERATIONAL_ACTION_HISTORY_EVENT_TYPES) {
    registerConsumer({
      eventType,
      consumerName: ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER,
      module: 'activity.outbox-consumers',
      handler: (event) => handleOperationalActionHistoryFact(deps, event),
    })
  }
}
