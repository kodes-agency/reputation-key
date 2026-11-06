import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { operationalActionHistoryRecordId } from '../domain/operational-action-history'
import type { ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER,
  handleOperationalActionHistoryFact,
  registerActivityOutboxConsumers,
} from './activity-outbox-consumers'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const event = (
  eventType: string,
  payload: Record<string, unknown>,
  overrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: '00000000-0000-4000-8000-000000000101',
  eventType,
  eventVersion: 1,
  payload,
  organizationId: 'org-1',
  propertyId: null,
  sourceContext: eventType.split('.')[0]!,
  sourceAggregateId: 'aggregate-1',
  recordedAt: '2026-08-28T09:00:00.000Z',
  correlationId: null,
  ...overrides,
})

const dependencies = () => {
  const appendOperationalHistoryOnce = vi.fn(async () => 'applied' as const)
  return {
    deps: {
      clock: () => new Date('2026-08-28T09:05:00.000Z'),
      operationalHistoryDeliveryStore: {
        applyOnce: appendOperationalHistoryOnce,
      },
      operationalHistoryIdGen: () =>
        operationalActionHistoryRecordId('00000000-0000-4000-8000-000000000202'),
    },
    appendOperationalHistoryOnce,
  }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterEach(() => {
  consumerRegistry = createConsumerRegistry()
  clearEventSchemas()
  vi.clearAllMocks()
})

describe('Activity durable Operational Action History consumer', () => {
  it.each(['property.archived', 'property.restored'] as const)(
    'appends %s to Operational Action History with exact source identity and no archive reason',
    async (eventType) => {
      const { deps, appendOperationalHistoryOnce } = dependencies()
      const source = event(
        eventType,
        {
          organizationId: 'org-1',
          propertyId: '00000000-0000-4000-8000-000000000311',
          userId: 'user-lifecycle-1',
          previousState: eventType === 'property.archived' ? 'active' : 'archived',
          sourceEpoch: 2,
          recoveryDeadline: '2026-09-04T09:00:00.000Z',
          googleBindingReadiness: 'reconnect_required',
          reason: 'manager supplied private archive reason',
          occurredAt: '2026-08-28T09:00:00.000Z',
          correlationId: null,
        },
        {
          propertyId: '00000000-0000-4000-8000-000000000311',
          sourceContext: 'property',
          sourceAggregateId: '00000000-0000-4000-8000-000000000311',
        },
      )

      await expect(handleOperationalActionHistoryFact(deps, source)).resolves.toEqual({
        status: 'applied',
      })

      expect(appendOperationalHistoryOnce).toHaveBeenCalledWith({
        record: expect.objectContaining({
          organizationId: 'org-1',
          propertyId: '00000000-0000-4000-8000-000000000311',
          actorType: 'user',
          actorId: 'user-lifecycle-1',
          action: eventType,
          outcome: 'succeeded',
          resourceType: 'property',
          resourceId: '00000000-0000-4000-8000-000000000311',
          reasonCode: null,
          provenance: {
            kind: 'domain_fact',
            id: source.eventId,
            eventType,
            eventVersion: 1,
            sourceContext: 'property',
            sourceAggregateId: '00000000-0000-4000-8000-000000000311',
          },
          occurredAt: new Date('2026-08-28T09:00:00.000Z'),
          recordedAt: new Date('2026-08-28T09:05:00.000Z'),
        }),
        eventId: source.eventId,
        consumerName: ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER,
      })
      expect(JSON.stringify(appendOperationalHistoryOnce.mock.calls)).not.toContain(
        'private archive',
      )
    },
  )
  it.each([
    {
      eventType: 'identity.member.role_changed',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        userId: 'manager-role-change',
        memberUserId: 'member-role-target',
        previousRole: 'Member',
        newRole: 'PropertyManager',
      },
      propertyId: null,
      actorType: 'user',
      actorId: 'manager-role-change',
      action: 'member.role_changed',
      resourceType: 'member',
      resourceId: 'member-role-target',
    },
    {
      eventType: 'identity.merchant_ai.changed',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000651',
        authorizationLineageId: '00000000-0000-4000-8000-000000000652',
        state: 'enabled',
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 0,
        analysisStartSequence: 0,
        stateVersion: 1,
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000651',
      actorType: 'system',
      actorId: null,
      action: 'capability.changed',
      resourceType: 'capability',
      resourceId: 'merchant_ai:00000000-0000-4000-8000-000000000651',
    },
    {
      eventType: 'integration.google_account.connected',
      eventVersion: 2,
      payload: {
        organizationId: 'org-1',
        connectionId: 'google-connection-v2',
        connectedBy: 'manager-google-connect-v2',
      },
      propertyId: null,
      actorType: 'user',
      actorId: 'manager-google-connect-v2',
      action: 'google_connection.connected',
      resourceType: 'google_connection',
      resourceId: 'google-connection-v2',
    },
    {
      eventType: 'integration.google_account.connected',
      eventVersion: 3,
      payload: {
        organizationId: 'org-1',
        connectionId: 'google-connection-1',
        userId: 'manager-google-connect',
      },
      propertyId: null,
      actorType: 'user',
      actorId: 'manager-google-connect',
      action: 'google_connection.connected',
      resourceType: 'google_connection',
      resourceId: 'google-connection-1',
    },
    {
      // A disconnect names the AccountAdmin who made it.
      eventType: 'integration.google_account.disconnected',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        connectionId: 'google-connection-named',
        userId: 'admin-google-disconnect',
      },
      propertyId: null,
      actorType: 'user',
      actorId: 'admin-google-disconnect',
      action: 'google_connection.disconnected',
      resourceType: 'google_connection',
      resourceId: 'google-connection-named',
    },
    {
      // The recovery reconciler cannot attribute some disconnects.
      eventType: 'integration.google_account.disconnected',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        connectionId: 'google-connection-unattributed',
        userId: null,
      },
      propertyId: null,
      actorType: 'system',
      actorId: null,
      action: 'google_connection.disconnected',
      resourceType: 'google_connection',
      resourceId: 'google-connection-unattributed',
    },
    {
      // Facts recorded before the field existed carry no actor at all.
      eventType: 'integration.google_account.disconnected',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        connectionId: 'google-connection-1',
      },
      propertyId: null,
      actorType: 'system',
      actorId: null,
      action: 'google_connection.disconnected',
      resourceType: 'google_connection',
      resourceId: 'google-connection-1',
    },
    {
      eventType: 'portal.publication.published',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000611',
        portalId: '00000000-0000-4000-8000-000000000612',
        publicationSnapshotId: 'snapshot-sensitive-and-excluded',
        publicationVersion: 2,
        publicationDigest: 'a'.repeat(64),
        userId: 'manager-portal-publish',
        sourceAggregateVersion: '2026-08-28T08:55:00.000Z',
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000611',
      actorType: 'user',
      actorId: 'manager-portal-publish',
      action: 'portal.published',
      resourceType: 'portal',
      resourceId: '00000000-0000-4000-8000-000000000612',
    },
    {
      eventType: 'portal.publication.published',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000611',
        portalId: '00000000-0000-4000-8000-000000000612',
        publicationSnapshotId: 'snapshot-sensitive-and-excluded',
        publicationVersion: 3,
        publicationDigest: 'a'.repeat(64),
        userId: 'ops:denev',
        sourceAggregateVersion: '2026-08-28T08:55:00.000Z',
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000611',
      actorType: 'operator',
      actorId: 'ops:denev',
      action: 'portal.published',
      resourceType: 'portal',
      resourceId: '00000000-0000-4000-8000-000000000612',
    },
    {
      eventType: 'portal.archived',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000611',
        portalId: '00000000-0000-4000-8000-000000000612',
        userId: 'manager-portal-archive',
        sourceAggregateVersion: '2026-08-28T08:55:00.000Z',
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000611',
      actorType: 'user',
      actorId: 'manager-portal-archive',
      action: 'portal.archived',
      resourceType: 'portal',
      resourceId: '00000000-0000-4000-8000-000000000612',
    },
    {
      eventType: 'portal.approved_destination.updated',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000661',
        approvedDestinationId: '00000000-0000-4000-8000-000000000662',
        approvalState: 'approved',
        sourceAggregateVersion: '2026-08-28T08:55:00.000Z',
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000661',
      actorType: 'system',
      actorId: null,
      action: 'policy.changed',
      resourceType: 'policy',
      resourceId: '00000000-0000-4000-8000-000000000662',
    },
    {
      eventType: 'property.deleted',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000621',
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000621',
      actorType: 'system',
      actorId: null,
      action: 'property.deleted',
      resourceType: 'property',
      resourceId: '00000000-0000-4000-8000-000000000621',
    },
    {
      eventType: 'review.reply.published',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000631',
        reviewId: '00000000-0000-4000-8000-000000000632',
        replyId: '00000000-0000-4000-8000-000000000633',
        userId: null,
        authorId: 'manager-reply-author',
        source: 'web',
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000631',
      actorType: 'user',
      actorId: 'manager-reply-author',
      action: 'google_reply.published',
      resourceType: 'reply',
      resourceId: '00000000-0000-4000-8000-000000000633',
    },
    {
      eventType: 'review.reply.published',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000641',
        reviewId: '00000000-0000-4000-8000-000000000642',
        replyId: '00000000-0000-4000-8000-000000000643',
        userId: null,
        authorId: null,
        source: 'web',
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000641',
      actorType: 'system',
      actorId: null,
      action: 'google_reply.published',
      resourceType: 'reply',
      resourceId: '00000000-0000-4000-8000-000000000643',
    },
  ] as const)(
    'appends the curated $eventType Operational Action History fact without copying source content',
    async (testCase) => {
      const { deps, appendOperationalHistoryOnce } = dependencies()
      const source = event(testCase.eventType, testCase.payload, {
        eventVersion: testCase.eventVersion,
        propertyId: testCase.propertyId,
        sourceContext: testCase.eventType.split('.')[0]!,
        sourceAggregateId: testCase.resourceId,
      })

      await expect(handleOperationalActionHistoryFact(deps, source)).resolves.toEqual({
        status: 'applied',
      })

      expect(appendOperationalHistoryOnce).toHaveBeenCalledWith({
        record: expect.objectContaining({
          organizationId: 'org-1',
          propertyId: testCase.propertyId,
          actorType: testCase.actorType,
          actorId: testCase.actorId,
          action: testCase.action,
          outcome: 'succeeded',
          resourceType: testCase.resourceType,
          resourceId: testCase.resourceId,
          reasonCode: null,
          provenance: {
            kind: 'domain_fact',
            id: source.eventId,
            eventType: testCase.eventType,
            eventVersion: testCase.eventVersion,
            sourceContext: testCase.eventType.split('.')[0],
            sourceAggregateId: testCase.resourceId,
          },
        }),
        eventId: source.eventId,
        consumerName: ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER,
      })
      expect(JSON.stringify(appendOperationalHistoryOnce.mock.calls)).not.toContain(
        'snapshot-sensitive-and-excluded',
      )
    },
  )
  it('registers the exact retained durable source-fact matrix', () => {
    const { deps } = dependencies()
    registerActivityOutboxConsumers(consumerRegistry, deps)

    const registrations = consumerRegistry
      .list()
      .filter(({ consumerName }) => consumerName === 'activity.recent-activity')
    expect(registrations).toEqual([])

    const operationalHistoryRegistrations = consumerRegistry
      .list()
      .filter(
        ({ consumerName }) =>
          consumerName === ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER,
      )
    expect(
      operationalHistoryRegistrations.map(({ eventType }) => eventType).sort(),
    ).toEqual(
      [
        'identity.merchant_ai.changed',
        'identity.member.role_changed',
        'integration.google_account.connected',
        'integration.google_account.disconnected',
        'portal.archived',
        'portal.approved_destination.updated',
        'portal.publication.published',
        'property.archived',
        'property.deleted',
        'property.restored',
        'review.reply.published',
      ].sort(),
    )
  })
})
