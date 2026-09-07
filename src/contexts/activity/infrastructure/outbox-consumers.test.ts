import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { recentActivityEntryId } from '#/shared/domain/ids'
import { operationalActionHistoryRecordId } from '../domain/operational-action-history'
import type { ConsumerEvent } from '#/shared/outbox'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  ACTIVITY_RECENT_ACTIVITY_CONSUMER,
  ACTIVITY_OPERATIONAL_ACTION_HISTORY_CONSUMER,
  handleOperationalActionHistoryFact,
  handleRecentActivityFact,
  registerActivityOutboxConsumers,
} from './outbox-consumers'

// ARC-03-T7: a fresh container-scoped registry per test.
let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}

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
  const applyOnce = vi.fn(async () => 'applied' as const)
  const recordObsolete = vi.fn(async () => 'obsolete' as const)
  const appendOperationalHistoryOnce = vi.fn(async () => 'applied' as const)
  return {
    deps: {
      deliveryStore: { applyOnce, recordObsolete },
      userLookup: {
        lookup: vi.fn(async () => ({
          name: 'Manager',
          avatarUrl: null,
          role: 'PropertyManager' as const,
          rawRole: 'PropertyManager',
        })),
      },
      inboxItemLookup: {
        findBySourceId: vi.fn(async (): Promise<string | null> => 'inbox-1'),
      },
      clock: () => new Date('2026-08-28T09:05:00.000Z'),
      logger,
      idGen: () => recentActivityEntryId('00000000-0000-4000-8000-000000000201'),
      operationalHistoryDeliveryStore: {
        applyOnce: appendOperationalHistoryOnce,
      },
      operationalHistoryIdGen: () =>
        operationalActionHistoryRecordId('00000000-0000-4000-8000-000000000202'),
    },
    applyOnce,
    recordObsolete,
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

describe('Activity durable Recent Activity consumer', () => {
  it('projects a content-free Property fact at source occurrence time and receipts it', async () => {
    const { deps, applyOnce } = dependencies()
    const source = event(
      'property.created',
      {
        propertyId: '00000000-0000-4000-8000-000000000301',
        organizationId: 'org-1',
        name: 'Must not become retained payload content',
        slug: 'must-not-be-copied',
        occurredAt: '2026-08-28T08:59:00.000Z',
      },
      { propertyId: '00000000-0000-4000-8000-000000000301' },
    )

    await expect(handleRecentActivityFact(deps, source)).resolves.toEqual({
      status: 'applied',
    })

    expect(applyOnce).toHaveBeenCalledWith({
      entry: expect.objectContaining({
        eventId: source.eventId,
        createdAt: new Date('2026-08-28T09:00:00.000Z'),
        resourceType: 'property',
        resourceId: '00000000-0000-4000-8000-000000000301',
        payload: { subject: 'property', from: null, to: null, detail: null },
      }),
      replayFact: expect.objectContaining({
        disposition: 'projectable',
        sourceEventId: source.eventId,
        sourceEventType: 'property.created',
        sourceEventVersion: 1,
      }),
      eventId: source.eventId,
      consumerName: ACTIVITY_RECENT_ACTIVITY_CONSUMER,
    })
    expect(JSON.stringify(applyOnce.mock.calls)).not.toContain('Must not become')
    expect(JSON.stringify(applyOnce.mock.calls)).not.toContain('must-not-be-copied')
  })

  it('marks a Reply fact obsolete when its governed Inbox relationship is gone', async () => {
    const { deps, applyOnce, recordObsolete } = dependencies()
    deps.inboxItemLookup.findBySourceId.mockResolvedValueOnce(null)
    const source = event(
      'review.reply.published',
      {
        replyId: '00000000-0000-4000-8000-000000000401',
        reviewId: '00000000-0000-4000-8000-000000000402',
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000403',
        userId: null,
        source: 'web',
        occurredAt: '2026-08-28T08:58:00.000Z',
      },
      { propertyId: '00000000-0000-4000-8000-000000000403' },
    )

    await expect(handleRecentActivityFact(deps, source)).resolves.toEqual({
      status: 'obsolete',
    })
    expect(applyOnce).not.toHaveBeenCalled()
    expect(recordObsolete).toHaveBeenCalledWith({
      replayFact: expect.objectContaining({
        disposition: 'obsolete',
        sourceEventId: source.eventId,
        sourceEventType: 'review.reply.published',
        sourceEventVersion: 1,
      }),
      eventId: source.eventId,
      consumerName: ACTIVITY_RECENT_ACTIVITY_CONSUMER,
    })
  })

  it.each([
    ['property.archived', 'active', 'archived'],
    ['property.restored', 'archived', 'active'],
  ] as const)(
    'projects %s without retaining the archive reason',
    async (eventType, previousState, nextState) => {
      const { deps, applyOnce } = dependencies()
      const source = event(
        eventType,
        {
          organizationId: 'org-1',
          propertyId: '00000000-0000-4000-8000-000000000311',
          userId: 'user-lifecycle-1',
          previousState,
          sourceEpoch: 2,
          recoveryDeadline: '2026-09-04T09:00:00.000Z',
          googleBindingReadiness: 'reconnect_required',
          reason: 'manager supplied private archive reason',
          occurredAt: '2026-08-28T09:00:00.000Z',
          correlationId: null,
        },
        { propertyId: '00000000-0000-4000-8000-000000000311' },
      )

      await handleRecentActivityFact(deps, source)

      expect(applyOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          replayFact: expect.objectContaining({
            sourceEventType: eventType,
            actorSubjectId: 'user-lifecycle-1',
            action: 'changed',
            resourceType: 'property',
            payload: {
              subject: 'property',
              from: previousState,
              to: nextState,
              detail: null,
            },
          }),
        }),
      )
      expect(JSON.stringify(applyOnce.mock.calls)).not.toContain('private archive')
    },
  )

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
        previousRole: 'Staff',
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
      eventType: 'portal.hero_image.published',
      eventVersion: 1,
      payload: {
        organizationId: 'org-1',
        propertyId: '00000000-0000-4000-8000-000000000671',
        portalId: '00000000-0000-4000-8000-000000000672',
        uploadId: '00000000-0000-4000-8000-000000000673',
        sourceAggregateVersion: '2026-08-28T08:55:00.000Z',
        occurredAt: '2026-08-28T08:56:00.000Z',
      },
      propertyId: '00000000-0000-4000-8000-000000000671',
      actorType: 'system',
      actorId: null,
      action: 'portal_upload.validated',
      resourceType: 'upload',
      resourceId: '00000000-0000-4000-8000-000000000673',
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

  it.each([
    {
      eventType: 'portal.publication.published',
      expectedAction: 'published',
      expectedSubject: 'portal_publication',
      expectedFrom: null,
      expectedTo: 'published',
      userId: 'manager-1',
      extra: {
        publicationSnapshotId: 'snapshot-1',
        publicationVersion: 3,
        publicationDigest: 'a'.repeat(64),
        sourceAggregateVersion: '2026-08-28T08:55:00.000Z',
      },
    },
    {
      eventType: 'portal.publication.rolled_back',
      expectedAction: 'changed',
      expectedSubject: 'portal_publication',
      expectedFrom: null,
      expectedTo: 'rolled_back',
      userId: 'manager-1',
      extra: {
        publicationSnapshotId: 'snapshot-1',
        publicationVersion: 2,
        publicationDigest: 'b'.repeat(64),
        sourceAggregateVersion: '2026-08-28T08:55:00.000Z',
      },
    },
    {
      eventType: 'portal.archived',
      expectedAction: 'changed',
      expectedSubject: 'portal',
      expectedFrom: null,
      expectedTo: 'archived',
      userId: 'manager-1',
      extra: { sourceAggregateVersion: '2026-08-28T08:55:00.000Z' },
    },
    {
      eventType: 'portal.restored',
      expectedAction: 'changed',
      expectedSubject: 'portal',
      expectedFrom: 'archived',
      expectedTo: 'disabled',
      userId: 'manager-1',
      extra: { sourceAggregateVersion: '2026-08-28T08:55:00.000Z' },
    },
    {
      eventType: 'portal.health.changed',
      expectedAction: 'changed',
      expectedSubject: 'portal_health',
      expectedFrom: 'degraded:google_destination_awaiting_refresh',
      expectedTo: 'healthy:operational',
      userId: null,
      extra: {
        previousStatus: 'degraded',
        previousReason: 'google_destination_awaiting_refresh',
        status: 'healthy',
        reason: 'operational',
        sourceVersion: 'must-not-be-retained',
      },
    },
  ] as const)(
    'projects the curated $eventType Portal lifecycle without snapshot or source metadata',
    async ({
      eventType,
      expectedAction,
      expectedSubject,
      expectedFrom,
      expectedTo,
      userId: expectedUserId,
      extra,
    }) => {
      const { deps, applyOnce } = dependencies()
      const source = event(
        eventType,
        {
          organizationId: 'org-1',
          propertyId: '00000000-0000-4000-8000-000000000321',
          portalId: '00000000-0000-4000-8000-000000000322',
          ...(expectedUserId ? { userId: expectedUserId } : {}),
          occurredAt: '2026-08-28T08:57:00.000Z',
          ...extra,
        },
        { propertyId: '00000000-0000-4000-8000-000000000321' },
      )

      await expect(handleRecentActivityFact(deps, source)).resolves.toEqual({
        status: 'applied',
      })

      expect(applyOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: expect.objectContaining({
            action: expectedAction,
            resourceType: 'portal',
            resourceId: '00000000-0000-4000-8000-000000000322',
            payload: {
              subject: expectedSubject,
              from: expectedFrom,
              to: expectedTo,
              detail: null,
            },
          }),
          replayFact: expect.objectContaining({
            sourceEventType: eventType,
            actorSubjectId: expectedUserId,
          }),
        }),
      )
      expect(JSON.stringify(applyOnce.mock.calls)).not.toContain('snapshot-1')
      expect(JSON.stringify(applyOnce.mock.calls)).not.toContain('must-not-be-retained')
    },
  )

  it.each([
    {
      eventType: 'goal.monthly_result.closed',
      status: 'closed',
      evaluationState: 'eligible',
      achieved: true,
      expectedTo: 'achieved',
      expectedDetail: 'eligible',
      extra: {},
    },
    {
      eventType: 'goal.monthly_result.reconciled',
      status: 'reconciling',
      evaluationState: 'updating',
      achieved: null,
      expectedTo: 'reconciling',
      expectedDetail: 'updating',
      extra: {},
    },
    {
      eventType: 'goal.monthly_result.revised',
      status: 'closed',
      evaluationState: 'unavailable',
      achieved: null,
      expectedTo: 'unavailable',
      expectedDetail: 'outcome_and_availability_changed',
      extra: {
        revisionId: '00000000-0000-4000-8000-000000000337',
        revision: 1,
        supersedesRevisionId: null,
        outcomeChanged: true,
        availabilityChanged: true,
      },
    },
  ] as const)(
    'projects the curated $eventType Goal lifecycle and supports legacy envelope scope',
    async ({
      eventType,
      status,
      evaluationState,
      achieved,
      expectedTo,
      expectedDetail,
      extra,
    }) => {
      const { deps, applyOnce } = dependencies()
      const property = '00000000-0000-4000-8000-000000000331'
      const source = event(
        eventType,
        {
          programId: '00000000-0000-4000-8000-000000000332',
          programVersionId: '00000000-0000-4000-8000-000000000333',
          assignmentId: '00000000-0000-4000-8000-000000000334',
          monthlyResultId: '00000000-0000-4000-8000-000000000335',
          periodStart: '2026-08-01T00:00:00.000Z',
          periodEnd: '2026-09-01T00:00:00.000Z',
          status,
          evaluationState,
          achieved,
          ...extra,
          sourceMetricValue: 'must-not-be-retained',
        },
        { propertyId: property },
      )

      await expect(handleRecentActivityFact(deps, source)).resolves.toEqual({
        status: 'applied',
      })

      expect(applyOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: expect.objectContaining({
            organizationId: 'org-1',
            propertyId: property,
            action: 'changed',
            resourceType: 'goal',
            resourceId: '00000000-0000-4000-8000-000000000335',
            payload: {
              subject: 'goal_result',
              from: null,
              to: expectedTo,
              detail: expectedDetail,
            },
          }),
          replayFact: expect.objectContaining({
            sourceEventType: eventType,
            actorSubjectId: null,
          }),
        }),
      )
      expect(JSON.stringify(applyOnce.mock.calls)).not.toContain('must-not-be-retained')
    },
  )

  it('registers the exact retained durable source-fact matrix', () => {
    const { deps } = dependencies()
    registerActivityOutboxConsumers(consumerRegistry, deps)

    const registrations = consumerRegistry
      .list()
      .filter(({ consumerName }) => consumerName === ACTIVITY_RECENT_ACTIVITY_CONSUMER)
    expect(registrations.map(({ eventType }) => eventType).sort()).toEqual(
      [
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
        'goal.monthly_result.closed',
        'goal.monthly_result.reconciled',
        'goal.monthly_result.revised',
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
      ].sort(),
    )

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
        'portal.hero_image.published',
        'portal.publication.published',
        'property.archived',
        'property.deleted',
        'property.restored',
        'review.reply.published',
      ].sort(),
    )
  })
})
